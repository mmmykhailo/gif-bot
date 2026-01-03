import { parseHTML } from "linkedom";
import { Bot, InputFile } from "grammy";
import { GifDatabase } from "./database";
import { writeFile, unlink } from "fs/promises";
import { join } from "path";

interface GifPost {
  gifUrl: string;
  description: string;
  postId: string;
}

const CHANNEL_URL = "https://t.me/s/index_gifok";
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_USER_ID = parseInt(process.env.ADMIN_USER_ID || "0");

if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

if (!ADMIN_USER_ID) {
  throw new Error("ADMIN_USER_ID environment variable is required for scraper");
}

const bot = new Bot(BOT_TOKEN);
const db = new GifDatabase();

/**
 * Fetch HTML from a URL (channel or specific post range)
 */
async function fetchHTML(url: string): Promise<string> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
  }

  return await response.text();
}

/**
 * Fetch and parse the Telegram channel HTML with pagination support
 */
async function fetchChannelPosts(maxPages: number = 10): Promise<GifPost[]> {
  console.log(`Fetching channel: ${CHANNEL_URL}`);

  const allPosts: GifPost[] = [];
  let beforeId: string | null = null;

  for (let page = 0; page < maxPages; page++) {
    const url = beforeId
      ? `${CHANNEL_URL}?before=${beforeId}`
      : CHANNEL_URL;

    console.log(`\nFetching page ${page + 1}/${maxPages}...`);

    const html = await fetchHTML(url);
    const { document } = parseHTML(html);

    // Find all message containers
    const messages = document.querySelectorAll(".tgme_widget_message");

    console.log(`  Found ${messages.length} messages on this page`);

    if (messages.length === 0) {
      console.log("  No more messages, stopping pagination");
      break;
    }

    let foundOnThisPage = 0;

    for (const message of messages) {
      try {
        // Get the post ID
        const messageLink = message.querySelector(".tgme_widget_message_date");
        const href = messageLink?.getAttribute("href");
        const postId = href?.split("/").pop() || "";

        // Update beforeId for pagination
        if (postId && (!beforeId || parseInt(postId) < parseInt(beforeId))) {
          beforeId = postId;
        }

        // Try to find GIF/video in multiple ways
        let gifUrl: string | null = null;

        // Method 1: video tag with source
        const video = message.querySelector("video");
        if (video) {
          const source = video.querySelector("source");
          gifUrl = source?.getAttribute("src") || null;
        }

        // Method 2: Check for animation/document with video
        if (!gifUrl) {
          const videoWrapper = message.querySelector(".tgme_widget_message_video_player");
          if (videoWrapper) {
            const videoTag = videoWrapper.querySelector("video");
            const source = videoTag?.querySelector("source");
            gifUrl = source?.getAttribute("src") || null;
          }
        }

        // Method 3: Check i tag background (sometimes used for previews)
        if (!gifUrl) {
          const iTag = message.querySelector("i.tgme_widget_message_video_thumb");
          if (iTag) {
            const style = iTag.getAttribute("style");
            const match = style?.match(/background-image:url\('([^']+)'\)/);
            if (match) {
              // This is just a thumbnail, try to find actual video
              const link = message.querySelector("a.tgme_widget_message_video_player");
              // For now, skip thumbnails and only use actual video URLs
            }
          }
        }

        // Method 4: Direct video in message photo/document
        if (!gifUrl) {
          const messageMedia = message.querySelector(".tgme_widget_message_photo, .tgme_widget_message_document");
          if (messageMedia) {
            const videoInMedia = messageMedia.querySelector("video source");
            gifUrl = videoInMedia?.getAttribute("src") || null;
          }
        }

        if (!gifUrl) {
          continue;
        }

        // Get the description from message text
        const messageText = message.querySelector(".tgme_widget_message_text");
        const description = messageText?.textContent?.trim();

        // Only add if both GIF and description exist
        if (gifUrl && description && description.length > 0) {
          allPosts.push({
            gifUrl,
            description,
            postId,
          });
          foundOnThisPage++;
        }
      } catch (error) {
        console.error("  Error parsing message:", error);
      }
    }

    console.log(`  Extracted ${foundOnThisPage} GIF posts with descriptions from this page`);

    // Small delay between pages to avoid rate limiting
    if (page < maxPages - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  console.log(`\nTotal extracted: ${allPosts.length} GIF posts with descriptions`);
  return allPosts;
}

/**
 * Download a GIF from URL
 */
async function downloadGif(url: string, filename: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download GIF: ${response.status}`);
  }

  const buffer = await response.arrayBuffer();
  const filepath = join("/tmp", filename);
  await writeFile(filepath, new Uint8Array(buffer));

  return filepath;
}

/**
 * Upload GIF to Telegram and get file IDs
 */
async function uploadGifToTelegram(
  filepath: string
): Promise<{ fileId: string; fileUniqueId: string } | null> {
  try {
    // Send the GIF to ourselves (admin) to get the file_id and file_unique_id
    const message = await bot.api.sendAnimation(
      ADMIN_USER_ID,
      new InputFile(filepath)
    );

    if (!message.animation) {
      console.error("No animation in response");
      return null;
    }

    return {
      fileId: message.animation.file_id,
      fileUniqueId: message.animation.file_unique_id,
    };
  } catch (error) {
    console.error("Error uploading to Telegram:", error);
    return null;
  }
}

/**
 * Process a single GIF post
 */
async function processGifPost(post: GifPost): Promise<boolean> {
  const { gifUrl, description, postId } = post;

  console.log(`Processing post ${postId}: ${description.substring(0, 50)}...`);

  let filepath: string | null = null;

  try {
    // Download the GIF
    const filename = `gif_${postId}_${Date.now()}.mp4`;
    filepath = await downloadGif(gifUrl, filename);
    console.log(`  ✓ Downloaded to ${filepath}`);

    // Upload to Telegram to get file IDs
    const fileIds = await uploadGifToTelegram(filepath);
    if (!fileIds) {
      console.log(`  ✗ Failed to upload to Telegram`);
      return false;
    }

    console.log(`  ✓ Uploaded to Telegram (${fileIds.fileUniqueId})`);

    // Check if already exists in database
    if (db.exists(fileIds.fileUniqueId)) {
      console.log(`  ℹ Already exists in database, skipping`);
      return false;
    }

    // Insert into database
    db.insert({
      file_unique_id: fileIds.fileUniqueId,
      file_id: fileIds.fileId,
      description: description,
      added_by: ADMIN_USER_ID,
    });

    console.log(`  ✓ Saved to database`);
    return true;
  } catch (error) {
    console.error(`  ✗ Error processing post ${postId}:`, error);
    return false;
  } finally {
    // Clean up downloaded file
    if (filepath) {
      try {
        await unlink(filepath);
      } catch (error) {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Main scraper function
 */
async function runScraper() {
  console.log("=== Starting GIF Scraper ===");
  console.log(`Target: ${CHANNEL_URL}`);
  console.log(`Database: ${db.getStats().totalGifs} GIFs currently stored`);
  console.log();

  try {
    // Fetch all posts from the channel
    const posts = await fetchChannelPosts();

    if (posts.length === 0) {
      console.log("No GIF posts found with descriptions");
      return;
    }

    console.log();
    console.log(`Processing ${posts.length} posts...`);
    console.log();

    let processed = 0;
    let added = 0;
    let skipped = 0;
    let failed = 0;

    // Process each post
    for (const post of posts) {
      processed++;
      console.log(`[${processed}/${posts.length}]`);

      const success = await processGifPost(post);
      if (success) {
        added++;
      } else {
        // Check if it was skipped or failed
        const tempFilepath = join("/tmp", `temp_check_${Date.now()}.mp4`);
        try {
          const downloadedPath = await downloadGif(post.gifUrl, `temp_${Date.now()}.mp4`);
          const fileIds = await uploadGifToTelegram(downloadedPath);
          await unlink(downloadedPath);

          if (fileIds && db.exists(fileIds.fileUniqueId)) {
            skipped++;
          } else {
            failed++;
          }
        } catch {
          failed++;
        }
      }

      console.log();

      // Add a small delay to avoid rate limiting
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log("=== Scraper Complete ===");
    console.log(`Total posts processed: ${processed}`);
    console.log(`Added to database: ${added}`);
    console.log(`Skipped (duplicates): ${skipped}`);
    console.log(`Failed: ${failed}`);
    console.log(`Database now contains: ${db.getStats().totalGifs} GIFs`);
  } catch (error) {
    console.error("Fatal error:", error);
    process.exit(1);
  } finally {
    db.close();
    process.exit(0);
  }
}

// Run the scraper
runScraper();

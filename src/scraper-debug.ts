import { parseHTML } from "linkedom";
import { writeFile } from "fs/promises";

const CHANNEL_URL = "https://t.me/s/index_gifok";

async function debugScraper() {
  console.log("=== Scraper Debug Mode ===");
  console.log(`Fetching: ${CHANNEL_URL}\n`);

  try {
    const response = await fetch(CHANNEL_URL, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    });

    if (!response.ok) {
      console.error(`Failed to fetch: ${response.status} ${response.statusText}`);
      process.exit(1);
    }

    const html = await response.text();
    const { document } = parseHTML(html);

    // Save HTML for inspection
    await writeFile("/tmp/telegram_channel.html", html);
    console.log("✓ Saved HTML to /tmp/telegram_channel.html\n");

    // Find all message containers
    const messages = document.querySelectorAll(".tgme_widget_message");
    console.log(`Found ${messages.length} messages\n`);

    // Inspect first 5 messages in detail
    for (let i = 0; i < Math.min(5, messages.length); i++) {
      const message = messages[i];
      console.log(`--- Message ${i + 1} ---`);

      // Get post ID
      const messageLink = message.querySelector(".tgme_widget_message_date");
      const href = messageLink?.getAttribute("href");
      const postId = href?.split("/").pop();
      console.log(`Post ID: ${postId}`);

      // Check for video
      const video = message.querySelector("video");
      console.log(`Has <video> tag: ${!!video}`);
      if (video) {
        const src = video.getAttribute("src") || video.querySelector("source")?.getAttribute("src");
        console.log(`  Video src: ${src ? src.substring(0, 80) + "..." : "(none)"}`);
      }

      // Check for video wrapper
      const videoWrapper = message.querySelector(".tgme_widget_message_video_player");
      console.log(`Has .tgme_widget_message_video_player: ${!!videoWrapper}`);

      // Check for animation
      const animation = message.querySelector(".tgme_widget_message_animation");
      console.log(`Has .tgme_widget_message_animation: ${!!animation}`);

      // Check for photo
      const photo = message.querySelector(".tgme_widget_message_photo");
      console.log(`Has .tgme_widget_message_photo: ${!!photo}`);

      // Check for document
      const document_el = message.querySelector(".tgme_widget_message_document");
      console.log(`Has .tgme_widget_message_document: ${!!document_el}`);

      // Get text
      const messageText = message.querySelector(".tgme_widget_message_text");
      const description = messageText?.textContent?.trim();
      console.log(`Description: ${description ? `"${description.substring(0, 60)}..."` : "(none)"}`);

      // Get all classes in the message
      const bubbleElement = message.querySelector(".tgme_widget_message_bubble");
      if (bubbleElement) {
        const allClasses = Array.from(bubbleElement.classList);
        console.log(`Bubble classes: ${allClasses.join(", ")}`);
      }

      console.log();
    }

    console.log("\n=== Summary ===");

    // Count different types
    let videoCount = 0;
    let textCount = 0;
    let videoWithTextCount = 0;

    for (const message of messages) {
      const hasVideo = !!message.querySelector("video");
      const hasText = !!message.querySelector(".tgme_widget_message_text")?.textContent?.trim();

      if (hasVideo) videoCount++;
      if (hasText) textCount++;
      if (hasVideo && hasText) videoWithTextCount++;
    }

    console.log(`Total messages: ${messages.length}`);
    console.log(`Messages with video: ${videoCount}`);
    console.log(`Messages with text: ${textCount}`);
    console.log(`Messages with BOTH video and text: ${videoWithTextCount}`);

    console.log("\n✓ Debug complete. Check /tmp/telegram_channel.html for full HTML.");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

debugScraper();

import { Bot, Context, InlineKeyboard, session, SessionFlavor } from "grammy";
import { GifDatabase } from "./database";

// Session data structure
interface SessionData {
  awaitingDescription?: {
    fileUniqueId: string;
    fileId: string;
  };
}

type BotContext = Context & SessionFlavor<SessionData>;

// Initialize bot
const BOT_TOKEN = process.env.BOT_TOKEN;
if (!BOT_TOKEN) {
  throw new Error("BOT_TOKEN environment variable is required");
}

const bot = new Bot<BotContext>(BOT_TOKEN);
const db = new GifDatabase();

// Session middleware
bot.use(
  session({
    initial: (): SessionData => ({}),
  })
);

// Command: /start
bot.command("start", async (ctx) => {
  await ctx.reply(
    "Welcome to the GIF Search Bot!\n\n" +
      "Send me a GIF in private chat, and I'll ask you for tags to describe it.\n" +
      "Then use @" + ctx.me.username + " <search query> to find GIFs inline!\n\n" +
      "Commands:\n" +
      "/start - Show this message\n" +
      "/stats - Show database statistics"
  );
});

// Command: /stats
bot.command("stats", async (ctx) => {
  const stats = db.getStats();
  await ctx.reply(`📊 Database Statistics:\nTotal GIFs: ${stats.totalGifs}`);
});

// Handle GIF messages in private chats
bot.on("message:animation", async (ctx) => {
  // Only process in private chats
  if (ctx.chat.type !== "private") {
    return;
  }

  const animation = ctx.message.animation;
  if (!animation) {
    return;
  }

  const fileUniqueId = animation.file_unique_id;
  const fileId = animation.file_id;

  // Store in session
  ctx.session.awaitingDescription = {
    fileUniqueId,
    fileId,
  };

  const exists = db.exists(fileUniqueId);
  if (exists) {
    await ctx.reply(
      "I already have this GIF! Send me additional tags to add to its description.",
      { reply_markup: { force_reply: true } }
    );
  } else {
    await ctx.reply(
      "Great! Now send me tags or a description for this GIF (e.g., 'funny cat dancing').",
      { reply_markup: { force_reply: true } }
    );
  }
});

// Handle text messages in private chats (descriptions for GIFs)
bot.on("message:text", async (ctx) => {
  // Only process in private chats
  if (ctx.chat.type !== "private") {
    return;
  }

  // Skip commands
  if (ctx.message.text.startsWith("/")) {
    return;
  }

  const session = ctx.session.awaitingDescription;
  if (!session) {
    await ctx.reply(
      "Please send me a GIF first, then I'll ask you for a description!"
    );
    return;
  }

  const { fileUniqueId, fileId } = session;
  const description = ctx.message.text.trim();

  if (!description) {
    await ctx.reply("Please provide a non-empty description!");
    return;
  }

  try {
    const exists = db.exists(fileUniqueId);

    if (exists) {
      // Update existing GIF
      db.update(fileUniqueId, description, fileId);
      await ctx.reply(
        `✅ Updated! Added "${description}" to the existing GIF tags.`
      );
    } else {
      // Insert new GIF
      db.insert({
        file_unique_id: fileUniqueId,
        file_id: fileId,
        description: description,
        added_by: ctx.from.id,
      });
      await ctx.reply(
        `✅ Saved! Your GIF can now be found with: "${description}"`
      );
    }

    // Clear session
    ctx.session.awaitingDescription = undefined;
  } catch (error) {
    console.error("Error saving GIF:", error);
    await ctx.reply(
      "❌ An error occurred while saving the GIF. Please try again."
    );
  }
});

// Handle inline queries
bot.on("inline_query", async (ctx) => {
  const query = ctx.inlineQuery.query.trim();

  try {
    // If query is empty, return last 20 added GIFs
    // Otherwise, search using FTS5
    const results = !query ? db.getRecent(20) : db.search(query, 20);

    // Convert to inline query results (without caption)
    const inlineResults = results.map((gif, index) => ({
      type: "gif" as const,
      id: `${gif.file_unique_id}_${index}`,
      gif_file_id: gif.file_id,
    }));

    // Answer inline query
    await ctx.answerInlineQuery(inlineResults, {
      cache_time: 300,
      is_personal: false,
    });
  } catch (error) {
    console.error("Error handling inline query:", error);
    // Return empty results on error
    await ctx.answerInlineQuery([], {
      cache_time: 10,
      is_personal: false,
    });
  }
});

// Error handling
bot.catch((err) => {
  const ctx = err.ctx;
  console.error(`Error while handling update ${ctx.update.update_id}:`);
  const e = err.error;
  console.error("Error:", e);
});

// Graceful shutdown
process.once("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully...");
  db.close();
  bot.stop();
});

process.once("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  db.close();
  bot.stop();
});

// Start the bot
console.log("Starting bot...");
bot.start({
  onStart: (botInfo) => {
    console.log(`Bot @${botInfo.username} is running!`);
    console.log(`Database stats:`, db.getStats());
  },
});

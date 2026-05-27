import { config } from "./src/config/index.js";
import { Bot } from "grammy";

async function run() {
  const bot = new Bot(config.telegram.token);
  const chatId = -1003966980568;
  
  // We can try to test a few recent message IDs around 235-240
  const messageIds = [235, 236, 237, 238, 239, 240, 241, 242];
  
  for (const messageId of messageIds) {
    try {
      await bot.api.editMessageReplyMarkup(chatId, messageId, { reply_markup: { inline_keyboard: [] } });
      console.log(`Msg ${messageId}: SUCESS`);
    } catch (error) {
      console.log(`Msg ${messageId}: ERROR = "${error.message}" | DESC = "${error.description}"`);
    }
  }
}

run();

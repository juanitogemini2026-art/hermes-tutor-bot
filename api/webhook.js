const { createClient } = require('@vercel/kv');
const { GoogleGenAI } = require('@google/genai');
const TelegramBot = require('node-telegram-bot-api');

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token_kv = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

// Initialize KV client explicitly
const kv = url && token_kv ? createClient({ url, token: token_kv }) : null;

const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function getUser(id) {
  if (!kv) throw new Error("Base de datos no configurada (faltan variables KV)");
  let user = await kv.get(`user:${id}`);
  if (!user) {
    user = { status: 'EXPLORING', current_track: null };
    await kv.set(`user:${id}`, user);
  }
  return user;
}

async function updateUserStatus(id, status, track) {
  const user = await getUser(id);
  user.status = status;
  user.current_track = track;
  await kv.set(`user:${id}`, user);
}

async function addIdea(id, idea) {
  let backlog = await kv.get(`backlog:${id}`) || [];
  backlog.push(idea);
  await kv.set(`backlog:${id}`, backlog);
}

async function getBacklog(id) {
  return await kv.get(`backlog:${id}`) || [];
}

const sysPrompt = `Eres un tutor Socrático estricto. NUNCA des la respuesta directa.
Reglas:
1. Haz preguntas que guíen al estudiante.
2. Si el estudiante se desvía del tema (current_track), recuérdale su objetivo actual.
3. Usa un tono motivador pero firme.`;

async function generateResponse(status, track, userMessage) {
  const prompt = `${sysPrompt}\n\nEstado del usuario: ${status}\nTema actual (Track): ${track || 'Ninguno'}\n\nEstudiante: ${userMessage}\nTutor:`;
  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: prompt,
  });
  return response.text;
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    // Debug route to check configuration
    let debug = "Bot is running on Vercel!\n";
    debug += `KV Configured: ${!!kv}\n`;
    debug += `Telegram Token: ${!!token}\n`;
    debug += `Gemini Key: ${!!process.env.GEMINI_API_KEY}\n`;
    return res.status(200).send(debug);
  }

  const { message } = req.body;
  if (!message || !message.text) {
    return res.status(200).send('OK');
  }

  const chatId = message.chat.id.toString();
  const text = message.text;

  try {
    const user = await getUser(chatId);

    if (text.startsWith('/estado')) {
      let response = `📊 **ESTADO ACTUAL**\nStatus: \`${user.status}\`\n`;
      if (user.current_track) response += `Track Activo: **${user.current_track}**\n`;
      await bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
      return res.status(200).send('OK');
    }

    if (text.startsWith('/idea_backlog')) {
      const idea = text.replace('/idea_backlog', '').trim();
      if (!idea) {
        await bot.sendMessage(chatId, "Dime qué idea quieres guardar. Ejemplo: `/idea_backlog Aprender Rust`", { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
      }
      await addIdea(chatId, idea);
      await bot.sendMessage(chatId, `✅ Idea guardada en tu Icebox/Backlog: "${idea}"`);
      return res.status(200).send('OK');
    }
    
    if (text.startsWith('/backlog')) {
      const ideas = await getBacklog(chatId);
      if (ideas.length === 0) {
        await bot.sendMessage(chatId, "Tu backlog está vacío.");
      } else {
        let resp = "🧊 **TU ICEBOX (Backlog)**\n";
        ideas.forEach((i, idx) => resp += `${idx+1}. ${i}\n`);
        await bot.sendMessage(chatId, resp, { parse_mode: 'Markdown' });
      }
      return res.status(200).send('OK');
    }

    const isChangingTopic = text.toLowerCase().includes("quiero aprender") || text.toLowerCase().includes("enséñame sobre");
    
    if (user.status === 'LOCKED_IN_TRACK' && isChangingTopic) {
        if (!text.toLowerCase().includes(user.current_track.toLowerCase().split(' ')[0])) {
            const lockWarning = `🔒 **GUARDIÁN DE FOCO ACTIVADO**\n\n` +
              `Tienes activo el track de **${user.current_track}**. Para saltar a otro tema debes:\n` +
              `(a) Pausar formalmente con justificación.\n` +
              `(b) Completar el hito actual.\n\n` +
              `Si solo es curiosidad, envíalo al backlog usando: /idea_backlog ${text.replace("quiero aprender", "").trim()} \n\n` +
              `¿Seguimos con tu track actual?`;
            await bot.sendMessage(chatId, lockWarning, { parse_mode: 'Markdown' });
            return res.status(200).send('OK');
        }
    }

    if (user.status === 'EXPLORING' && (text.toLowerCase().includes('acepto el reto') || text.toLowerCase().includes('empecemos'))) {
        const match = text.match(/reto de (.*)/i) || ["", "Nuevo Tema"];
        await updateUserStatus(chatId, 'LOCKED_IN_TRACK', match[1] || 'Track Generico');
        await bot.sendMessage(chatId, "🔒 **FOCO BLOQUEADO**. Tu estado ahora es `LOCKED_IN_TRACK`. ¡A trabajar! Escribe algo sobre el tema para evaluarte.", { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
    }
    
    if (text.toLowerCase().includes('pausar track') || text.toLowerCase().includes('completado')) {
        await updateUserStatus(chatId, 'EXPLORING', null);
        await bot.sendMessage(chatId, "🔓 **TRACK LIBERADO**. Tu estado ahora es `EXPLORING`. ¿Qué nuevo reto quieres iniciar?", { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
    }

    await bot.sendChatAction(chatId, 'typing');
    const aiResponse = await generateResponse(user.status, user.current_track, text);
    await bot.sendMessage(chatId, aiResponse, { parse_mode: 'Markdown' });

  } catch (error) {
    console.error("Error processing message:", error);
    try {
      await bot.sendMessage(chatId, `⚠️ Error interno: ${error.message}`);
    } catch(e) {}
  }

  res.status(200).send('OK');
};

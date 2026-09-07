const { createClient } = require('@vercel/kv');
const { GoogleGenAI } = require('@google/genai');
const TelegramBot = require('node-telegram-bot-api');

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token_kv = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const kv = url && token_kv ? createClient({ url, token: token_kv }) : null;
const token = process.env.TELEGRAM_BOT_TOKEN;
const bot = new TelegramBot(token);
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function getUser(id) {
  if (!kv) throw new Error("Base de datos no configurada.");
  let user = await kv.get(`user:${id}`);
  if (!user) {
    user = { status: 'EXPLORING', current_track: null, chapter: 0 };
    await kv.set(`user:${id}`, user);
  }
  return user;
}

async function saveUser(id, user) {
  await kv.set(`user:${id}`, user);
}

async function generateSyllabus(topic) {
  const prompt = `Eres un experto en Ultra-Learning. Crea un temario de maestría hiper-condensado de 4 hitos sobre "${topic}" usando Pareto (80/20) y Primeros Principios.
Devuelve ÚNICAMENTE un array JSON válido. Cada elemento del array debe ser un string con TODA la teoría densa de ese hito, lista para enseñar, con analogías de Feynman. No uses bloques markdown alrededor del JSON.`;
  
  const response = await ai.models.generateContent({
    model: 'gemini-3.6-flash',
    contents: prompt,
  });
  let text = response.text.trim();
  if (text.startsWith('```json')) text = text.replace(/```json/g, '').replace(/```/g, '').trim();
  if (text.startsWith('```')) text = text.replace(/```/g, '').trim();
  return JSON.parse(text);
}

const sysPrompt = `Eres un Tutor Privado de Ultra-Learning. 
TU MISIÓN ACTUAL:
Estás enseñando un fragmento del temario. 
1. Explica brevemente la duda del estudiante si la tiene.
2. NUNCA avances al siguiente tema. El sistema te avisará cuándo avanzar.
3. Evalúa con 1 sola pregunta de 'Active Recall' Socrática sobre el material actual para obligarlo a pensar.`;

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(200).send('Bot Ultra-Learning Running!');
  const { message } = req.body;
  if (!message || !message.text) return res.status(200).send('OK');

  const chatId = message.chat.id.toString();
  const text = message.text;

  try {
    const user = await getUser(chatId);

    if (text === '/estado') {
      await bot.sendMessage(chatId, `📊 Estado: ${user.status}\nTrack: ${user.current_track || 'Ninguno'}\nHito Actual: ${user.chapter + 1}`);
      return res.status(200).send('OK');
    }

    if (text === '/mis_apuntes') {
      const syllabus = await kv.get(`syllabus:${chatId}`);
      if (!syllabus) {
        await bot.sendMessage(chatId, "No tienes apuntes activos. Inicia un tema con: quiero aprender [tema]");
        return res.status(200).send('OK');
      }
      let apuntes = `📚 **TUS APUNTES: ${user.current_track}**\n\n`;
      syllabus.forEach((cap, i) => apuntes += `**Hito ${i+1}:**\n${cap}\n\n`);
      // Telegram has a 4096 char limit, send chunked if needed
      if (apuntes.length > 4000) apuntes = apuntes.substring(0, 4000) + "... (recortado)";
      await bot.sendMessage(chatId, apuntes, { parse_mode: 'Markdown' });
      return res.status(200).send('OK');
    }

    const isChangingTopic = text.toLowerCase().includes("quiero aprender") || text.toLowerCase().includes("enséñame sobre");

    if (user.status === 'EXPLORING' && isChangingTopic) {
        const match = text.match(/aprender (.*)/i) || text.match(/sobre (.*)/i) || ["", "Tema nuevo"];
        const topic = match[1];
        await bot.sendMessage(chatId, `🧠 Generando Cuaderno de Estudio (Ultra-Learning) sobre: **${topic}**... Espera unos segundos.`, { parse_mode: 'Markdown' });
        
        try {
            const syllabus = await generateSyllabus(topic);
            await kv.set(`syllabus:${chatId}`, syllabus);
            user.status = 'LOCKED_IN_TRACK';
            user.current_track = topic;
            user.chapter = 0;
            await saveUser(chatId, user);
            
            const firstChapter = syllabus[0];
            await bot.sendMessage(chatId, `✅ Cuaderno generado (4 Hitos).\n\n🔒 **FOCO BLOQUEADO: ${topic}**\n\n**Hito 1:**\n${firstChapter}\n\n*(Lee esto y dime qué entendiste o responde si te hice una pregunta)*`, { parse_mode: 'Markdown' });
        } catch(err) {
            await bot.sendMessage(chatId, `Error generando syllabus: ${err.message}`);
        }
        return res.status(200).send('OK');
    }

    if (user.status === 'LOCKED_IN_TRACK') {
        if (text.toLowerCase() === '/siguiente') {
            const syllabus = await kv.get(`syllabus:${chatId}`);
            if (user.chapter + 1 >= syllabus.length) {
                user.status = 'EXPLORING';
                user.current_track = null;
                await saveUser(chatId, user);
                await bot.sendMessage(chatId, "🎉 ¡Felicidades! Has dominado este track. Tu estado vuelve a EXPLORING. ¿Qué quieres aprender ahora?");
            } else {
                user.chapter += 1;
                await saveUser(chatId, user);
                await bot.sendMessage(chatId, `➡️ **Hito ${user.chapter + 1}**:\n\n${syllabus[user.chapter]}\n\n*(Léelo y prepárate para la evaluación)*`, { parse_mode: 'Markdown' });
            }
            return res.status(200).send('OK');
        }

        if (isChangingTopic && !text.toLowerCase().includes(user.current_track.toLowerCase().split(' ')[0])) {
            await bot.sendMessage(chatId, `🛡️ **Guardián de Foco:** Estás bloqueado en **${user.current_track}**. Escribe '/siguiente' para avanzar al próximo hito, o '/abandonar' si realmente quieres salir.`);
            return res.status(200).send('OK');
        }

        if (text.toLowerCase() === '/abandonar') {
            user.status = 'EXPLORING';
            await saveUser(chatId, user);
            await bot.sendMessage(chatId, "Track abandonado. Estado: EXPLORING.");
            return res.status(200).send('OK');
        }

        // Send current context to Gemini for chat
        const syllabus = await kv.get(`syllabus:${chatId}`);
        const currentTheory = syllabus[user.chapter];
        const prompt = `${sysPrompt}\n\nTeoría Actual (Hito ${user.chapter + 1}):\n${currentTheory}\n\nEstudiante dice: ${text}\nTutor:`;
        
        await bot.sendChatAction(chatId, 'typing');
        const response = await ai.models.generateContent({ model: 'gemini-3.6-flash', contents: prompt });
        await bot.sendMessage(chatId, response.text, { parse_mode: 'Markdown' });
        return res.status(200).send('OK');
    }

    await bot.sendMessage(chatId, "No entendí. Usa 'Quiero aprender [tema]' para iniciar un Track de Ultra-Learning.");
  } catch (error) {
    try { await bot.sendMessage(chatId, `⚠️ Error: ${error.message}`); } catch(e) {}
  }
  res.status(200).send('OK');
};

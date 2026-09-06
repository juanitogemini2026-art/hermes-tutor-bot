require('dotenv').config();
const TelegramBot = require('node-telegram-bot-api');
const db = require('./db');
const ai = require('./ai');

const token = process.env.TELEGRAM_BOT_TOKEN;
const allowedUser = process.env.TELEGRAM_ALLOWED_USERS;

if (!token || !process.env.GEMINI_API_KEY) {
  console.error("Faltan variables de entorno: TELEGRAM_BOT_TOKEN o GEMINI_API_KEY");
  process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

bot.on('message', async (msg) => {
  const chatId = msg.chat.id.toString();
  const text = msg.text;

  // Seguridad: Solo permite al usuario autorizado
  if (allowedUser && chatId !== allowedUser) {
    bot.sendMessage(chatId, "Acceso denegado. No eres mi estudiante asignado.");
    return;
  }

  if (!text) return;

  // Obtener estado del usuario
  const user = await db.getUser(chatId);

  // Comando /estado
  if (text.startsWith('/estado')) {
    let response = `📊 **ESTADO ACTUAL**\nStatus: \`${user.status}\`\n`;
    if (user.current_track) response += `Track Activo: **${user.current_track}**\n`;
    bot.sendMessage(chatId, response, { parse_mode: 'Markdown' });
    return;
  }

  // Comando /idea_backlog
  if (text.startsWith('/idea_backlog')) {
    const idea = text.replace('/idea_backlog', '').trim();
    if (!idea) {
      bot.sendMessage(chatId, "Dime qué idea quieres guardar. Ejemplo: `/idea_backlog Aprender Rust`", { parse_mode: 'Markdown' });
      return;
    }
    await db.addIdeaToBacklog(chatId, idea);
    bot.sendMessage(chatId, `✅ Idea guardada en tu Icebox/Backlog: "${idea}"`);
    return;
  }
  
  // Comando /backlog para ver ideas
  if (text.startsWith('/backlog')) {
    const ideas = await db.getBacklog(chatId);
    if (ideas.length === 0) {
      bot.sendMessage(chatId, "Tu backlog está vacío.");
    } else {
      let resp = "🧊 **TU ICEBOX (Backlog)**\n";
      ideas.forEach((i, idx) => resp += `${idx+1}. ${i.idea}\n`);
      bot.sendMessage(chatId, resp, { parse_mode: 'Markdown' });
    }
    return;
  }

  // Interceptar Cambio de Foco
  // Si el usuario está LOCKED_IN_TRACK e intenta empezar un "quiero aprender X" que no parece ser su track
  const isChangingTopic = text.toLowerCase().includes("quiero aprender") || text.toLowerCase().includes("enséñame sobre");
  
  if (user.status === 'LOCKED_IN_TRACK' && isChangingTopic) {
      // Check if it mentions the current track roughly
      if (!text.toLowerCase().includes(user.current_track.toLowerCase().split(' ')[0])) {
          const lockWarning = \`🔒 **GUARDIÁN DE FOCO ACTIVADO**\n\n\` +
            \`Tienes activo el track de **\${user.current_track}**. Para saltar a otro tema debes:\n\` +
            \`(a) Pausar formalmente con justificación.\n\` +
            \`(b) Completar el hito actual.\n\n\` +
            \`Si solo es curiosidad, envíalo al backlog usando: /idea_backlog \${text.replace("quiero aprender", "").trim()} \n\n\` +
            \`¿Seguimos con tu track actual?\`;
          bot.sendMessage(chatId, lockWarning, { parse_mode: 'Markdown' });
          return;
      }
  }

  // Simulador simple para Aceptar Reto y bloquear foco
  if (user.status === 'EXPLORING' && (text.toLowerCase().includes('acepto el reto') || text.toLowerCase().includes('empecemos'))) {
      const match = text.match(/reto de (.*)/i) || ["", "Nuevo Tema"];
      await db.updateUserStatus(chatId, 'LOCKED_IN_TRACK', match[1] || 'Track Generico');
      bot.sendMessage(chatId, "🔒 **FOCO BLOQUEADO**. Tu estado ahora es `LOCKED_IN_TRACK`. ¡A trabajar! Escribe algo sobre el tema para evaluarte.", { parse_mode: 'Markdown' });
      return;
  }
  
  if (text.toLowerCase().includes('pausar track') || text.toLowerCase().includes('completado')) {
      await db.updateUserStatus(chatId, 'EXPLORING', null);
      bot.sendMessage(chatId, "🔓 **TRACK LIBERADO**. Tu estado ahora es `EXPLORING`. ¿Qué nuevo reto quieres iniciar?", { parse_mode: 'Markdown' });
      return;
  }

  // Respuesta de la IA
  bot.sendChatAction(chatId, 'typing');
  const aiResponse = await ai.generateResponse(user.status, user.current_track, text);
  bot.sendMessage(chatId, aiResponse, { parse_mode: 'Markdown' });
});

console.log("Tutor-X Bot iniciado (Polling)...");

// ==========================================
// SERVIDOR WEB PARA HEALTH CHECKS (NUBE)
// ==========================================
// Las plataformas gratuitas (Koyeb, Render) requieren que el contenedor 
// responda a peticiones HTTP en un puerto para saber que está vivo.
const http = require('http');
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Tutor-X Bot is running!\\n');
}).listen(PORT, () => {
  console.log(\`Servidor HTTP escuchando en el puerto \${PORT} (Healthcheck OK)\`);
});

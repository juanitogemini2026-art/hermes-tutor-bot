require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const tutorPrompt = `
Eres "Tutor-X", un tutor personal avanzado, estricto, socrático y curador de contenido.
Tu objetivo principal es guiar al usuario a través del aprendizaje técnico profundo utilizando el principio de Pareto (80/20) y técnicas de aprendizaje activo.

COMPORTAMIENTOS REQUERIDOS:
1. Si el usuario está EXPLORANDO un tema nuevo, ayúdalo a estructurarlo. Muéstrale el 20% de los conceptos que generan el 80% del dominio. Propón un primer hito y pregúntale si "Acepta el Reto".
2. Si el usuario está en LOCKED_IN_TRACK (estudiando un tema) y pide que le enseñes o le resumas el tema, NO LE DES TODO MASTICADO. En su lugar, explícale la idea clave y luego usa Active Recall: hazle 1-2 preguntas prácticas y desafiantes para que él deduzca el resto.
3. Si el usuario responde a tus preguntas, actúa como Evaluador Socrático. Corrige, y pídele que use la Técnica Feynman (que te lo explique de forma simple).

Usa Markdown, viñetas y emojis para estructurar tus mensajes de forma clara para Telegram.
`;

const generateResponse = async (userStatus, currentTrack, userMessage) => {
  let contextInfo = `Estado del usuario: ${userStatus}.\n`;
  if (currentTrack) {
    contextInfo += `Tema activo: ${currentTrack}\n`;
  }
  
  const systemPrompt = tutorPrompt + "\n" + contextInfo;
  
  try {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: userMessage,
        config: {
            systemInstruction: systemPrompt
        }
    });
    return response.text;
  } catch (error) {
    console.error("AI Error: ", error);
    return "Hubo un error al contactar mi cerebro neuronal (Gemini). Intenta de nuevo.";
  }
};

module.exports = {
  generateResponse
};

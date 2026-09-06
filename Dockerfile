FROM node:20-slim

# Crea el directorio de trabajo
WORKDIR /app

# Copia los archivos de configuración
COPY package*.json ./

# Instala dependencias (con sqlite3 nativo requiere build tools a veces, slim lo soporta bien)
RUN npm install

# Copia el resto del código
COPY . .

# Expone el puerto (para el healthcheck de Hugging Face Spaces)
ENV PORT=7860
EXPOSE 7860

# Comando para iniciar
CMD ["npm", "start"]

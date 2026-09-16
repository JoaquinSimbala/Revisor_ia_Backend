/**
 * LLMService: Orquestador de inferencia con Google Gemini y respuesta JSON estructurada.
 */
export class LLMService {
  constructor(apiKey = process.env.GEMINI_API_KEY) {
    this.apiKey = apiKey?.trim();
  }

  /**
   * Genera el análisis de refactorización y código de reemplazo.
   * @param {object} params
   * @param {string} params.filePath
   * @param {string} params.language
   * @param {string} params.deletedCode
   * @param {string} params.surroundingContext
   * @param {object} params.githubContext
   * @returns {Promise<{ explanation: string, replacement_code: string, compatibility_notes: string }>}
   */
  async analyzeCodeChange({ filePath, language, deletedCode, surroundingContext, githubContext }) {
    const key = this.apiKey || process.env.GEMINI_API_KEY;

    if (!key) {
      console.warn('[LLMService] ALERTA: GEMINI_API_KEY no está configurada en las variables de entorno.');
      return {
        explanation: `⚠️ **GEMINI_API_KEY no detectada en el servidor**\n\nEl servidor backend está respondiendo en modo simulación porque no tiene configurada tu clave de Google Gemini.\n\n• **Solución**: Ve a tu servicio \`revisor-ia-backend\` en **Render** > pestaña **Environment** > añade la variable \`GEMINI_API_KEY\` con tu clave de [Google AI Studio](https://aistudio.google.com/app/apikey).`,
        replacement_code: `// Para obtener análisis reales de Gemini AI con código mejorado:\n// 1. Ve a Render -> Environment\n// 2. Agrega GEMINI_API_KEY=tu_clave\n// 3. Render se reiniciará en 30 segundos\n\n${deletedCode}`,
        compatibility_notes: `⚠️ Modo contingencia activo: Configura GEMINI_API_KEY en Render para activar la inferencia de IA en tiempo real.`
      };
    }

    const systemPrompt = `Eres un arquitecto de software senior y experto en refactorización y análisis estático de código.
El desarrollador está editando el archivo "${filePath}" (${language}). Acaba de modificar o borrar un fragmento de código.

Tu misión es realizar un análisis TÉCNICO PROFUNDO, PRECISO y CONCRETO (NADA de respuestas genéricas o ambiguas).

Debes devolver EXCLUSIVAMENTE un objeto JSON válido con la siguiente estructura:
{
  "explanation": "Explicación detallada y exhaustiva en markdown: 1) Qué hacía exactamente cada línea del código eliminado (variables, eventos, llamadas). 2) Qué consecuencias o efectos colaterales produce su eliminación (rotura de estado, dependencias, eventos no manejados, índices faltantes). 3) Por qué la propuesta de sustitución es superior.",
  "replacement_code": "Una versión mejorada, limpia y moderna del código. NO devuelvas el mismo código tal cual. Aplica buenas prácticas (manejo robusto de errores, tipado o validaciones defensivas, optimizaciones o sintaxis moderna) pero asegurando compatibilidad total con el resto del archivo.",
  "compatibility_notes": "Puntos técnicos clave sobre: firmas de funciones, tipos devueltos, argumentos requeridos y cómo encaja con el código adyacente para no causar breaking changes."
}`;

    const userContent = `
ARCHIVO: ${filePath}
LENGUAJE: ${language || 'javascript'}

CÓDIGO ELIMINADO / MODIFICADO:
\`\`\`${language}
${deletedCode}
\`\`\`

CONTEXTO CIRCUNDANTE DEL ARCHIVO (Líneas adyacentes):
\`\`\`${language}
${surroundingContext}
\`\`\`

${githubContext?.relevantTypes ? `CONTEXTO DE REPOSITORIO: ${githubContext.relevantTypes}` : ''}

Recuerda: Devuelve ÚNICAMENTE el objeto JSON sin bloques de markdown adicionales.`;

    // Lista de modelos ordenados por estabilidad y disponibilidad para sortear picos de demanda (503)
    const modelsToTry = [
      'gemini-flash-latest',     // Alias oficial de Google que siempre apunta al Flash más estable disponible
      'gemini-3.5-flash',        // Modelo 3.5 de alta disponibilidad
      'gemini-3.7-flash',        // Modelo 3.7
      'gemini-3.6-flash',        // Modelo 3.6
      'gemini-3.5-flash-lite',   // Modelo ligero ultrarrápido
      'gemini-flash-lite-latest' // Alias oficial de Google para Flash Lite
    ];

    for (const model of modelsToTry) {
      try {
        console.log(`[LLMService] Consultando Gemini API (${model}) para ${filePath}...`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;

        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [
              {
                role: 'user',
                parts: [{ text: `${systemPrompt}\n\n${userContent}` }]
              }
            ],
            generationConfig: {
              temperature: 0.2,
              responseMimeType: 'application/json'
            }
          })
        });

        if (!response.ok) {
          const errBody = await response.text();
          console.warn(`[LLMService] Modelo ${model} respondió status ${response.status}. Intentando siguiente alternativa...`);
          continue; // Probar siguiente modelo automáticamente ante 503 o 404
        }

        const data = await response.json();
        const rawText = data.candidates?.[0]?.content?.parts?.[0]?.text;

        if (rawText) {
          const cleanJson = rawText.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
          const parsed = JSON.parse(cleanJson);
          if (parsed.explanation && parsed.replacement_code) {
            console.log(`[LLMService] ✓ Análisis exitoso con modelo: ${model}`);
            return parsed;
          }
        }
      } catch (err) {
        console.warn(`[LLMService] Excepción en ${model} (${err.message}). Intentando siguiente...`);
      }
    }

    // Respaldo dinámico en caso de que todos los anteriores tengan sobrecarga simultánea
    try {
      console.log('[LLMService] Buscando modelos de texto alternativos en tu cuenta...');
      const listRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
      if (listRes.ok) {
        const listData = await listRes.json();
        const validTextModels = (listData.models || [])
          .map(m => m.name.replace(/^models\//, ''))
          .filter(name => 
            (name.includes('flash') || name.includes('pro')) &&
            !name.includes('tts') &&
            !name.includes('image') &&
            !name.includes('audio') &&
            !name.includes('transcribe') &&
            !name.includes('2.5') // Excluir 2.5 obsoleto
          );

        console.log('[LLMService] Modelos de texto filtrados:', validTextModels);

        for (const dynModel of validTextModels.slice(0, 5)) {
          const dynUrl = `https://generativelanguage.googleapis.com/v1beta/models/${dynModel}:generateContent?key=${key}`;
          const dynResp = await fetch(dynUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ role: 'user', parts: [{ text: `${systemPrompt}\n\n${userContent}` }] }],
              generationConfig: { temperature: 0.2, responseMimeType: 'application/json' }
            })
          });

          if (dynResp.ok) {
            const dynData = await dynResp.json();
            const dynText = dynData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (dynText) {
              const cleanJson = dynText.trim().replace(/^```json\s*/, '').replace(/\s*```$/, '');
              const parsed = JSON.parse(cleanJson);
              if (parsed.explanation && parsed.replacement_code) {
                console.log(`[LLMService] ✓ Análisis exitoso con modelo dinámico: ${dynModel}`);
                return parsed;
              }
            }
          }
        }
      }
    } catch (discoveryErr) {
      console.error('[LLMService] Error en descubrimiento dinámico:', discoveryErr.message);
    }

    // Si fallan las llamadas a la API (por cuota o clave inválida)
    console.error('[LLMService] No se pudo obtener respuesta válida de Gemini.');
    return {
      explanation: `⚠️ **Error al consultar la API de Gemini**\n\nSe intentó conectar con Gemini pero la API retornó un error. Verifica que tu \`GEMINI_API_KEY\` en Render sea válida y no tenga restricciones de IP o cuota excedida.\n\n• **Código afectado**: \`${filePath}\` (${deletedCode.split('\n').length} líneas).`,
      replacement_code: `// Código original:\n${deletedCode}`,
      compatibility_notes: `Revisa los logs del servicio en Render para ver el detalle del error retornado por Google AI Studio.`
    };
  }
}

export const llmService = new LLMService();

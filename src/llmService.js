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
  async analyzeCodeChange({ filePath, language, deletedCode, lineRange, surroundingContext, githubContext }) {
    const key = this.apiKey || process.env.GEMINI_API_KEY;

    if (!key) {
      console.warn('[LLMService] ALERTA: GEMINI_API_KEY no está configurada en las variables de entorno.');
      return {
        explanation: `⚠️ **GEMINI_API_KEY no detectada en el servidor**\n\nEl servidor backend está respondiendo en modo simulación porque no tiene configurada tu clave de Google Gemini.\n\n• **Solución**: Ve a tu servicio \`revisor-ia-backend\` en **Render** > pestaña **Environment** > añade la variable \`GEMINI_API_KEY\` con tu clave de [Google AI Studio](https://aistudio.google.com/app/apikey).`,
        replacement_code: `// Para obtener análisis reales de Gemini AI con código mejorado:\n// 1. Ve a Render -> Environment\n// 2. Agrega GEMINI_API_KEY=tu_clave\n// 3. Render se reiniciará en 30 segundos\n\n${deletedCode}`,
        compatibility_notes: `⚠️ Modo contingencia activo: Configura GEMINI_API_KEY en Render para activar la inferencia de IA en tiempo real.`
      };
    }

    const lineCount = (deletedCode || '').split('\n').length;
    const scopeDescription = lineRange ? `${lineRange} (${lineCount} línea(s))` : `${lineCount} línea(s)`;

    const systemPrompt = `Eres un arquitecto de software senior y especialista en refactorización quirúrgica de código limpio.
El desarrollador está editando "${filePath}" (${language}).
Acaba de seleccionar/modificar/borrar un fragmento específico: ${scopeDescription}.

REGLAS QUIRÚRGICAS ESTRICTAS (DE CUMPLIMIENTO OBLIGATORIO):
1. REEMPLAZO EXACTO 1:1 (DROP-IN REPLACEMENT):
   Tu "replacement_code" debe reemplazar ÚNICA Y EXCLUSIVAMENTE el fragmento intervenido (${scopeDescription}).
   - Si el desarrollador modificó 1 sola línea o 1 sola palabra/expresión, tu "replacement_code" debe contener EXACTAMENTE esa 1 línea o expresión mejorada.
   - Si modificó 3 líneas, tu "replacement_code" debe ser el equivalente estricto de esas 3 líneas.
   - Si modificó 50 o 100 líneas, tu "replacement_code" debe corresponder a esas 50 o 100 líneas.
   - JAMÁS devuelvas el archivo entero ni funciones externas circundantes que el usuario no borró.
   - El desarrollador copiará "replacement_code" y lo pegará DIRECTAMENTE sobre el espacio que dejó el fragmento intervenido. Debe encajar a la perfección sin líneas duplicadas.

2. CÓDIGO MEJORADO Y SIN BREAKING CHANGES:
   El código propuesto debe ser limpio, moderno, robusto y respetar los nombres de variables, argumentos y tipos esperados por el resto del archivo para que funcione inmediatamente al pegarlo.

3. FORMATO JSON OBLIGATORIO:
   Devuelve ÚNICAMENTE un objeto JSON con:
   - "explanation": Análisis técnico didáctico de qué hacía exactamente ese fragmento específico de ${scopeDescription} y el impacto de su alteración.
   - "replacement_code": El fragmento de código quirúrgico listo para sustitución directa.
   - "compatibility_notes": Garantías de tipado, parámetros y firmas de métodos.`;

    const userContent = `
ARCHIVO: ${filePath}
UBICACIÓN: ${scopeDescription}
LENGUAJE: ${language || 'javascript'}

FRAGMENTO EXACTO MODIFICADO O BORRADO (Sustituir quirúrgicamente esto):
\`\`\`${language}
${deletedCode}
\`\`\`

CONTEXTO CIRCUNDANTE DEL ARCHIVO (Líneas adyacentes de referencia - NO las incluyas en replacement_code):
\`\`\`${language}
${surroundingContext}
\`\`\`

${githubContext?.relevantTypes ? `CONTEXTO DE REPOSITORIO: ${githubContext.relevantTypes}` : ''}

Recuerda: Tu "replacement_code" debe reemplazar ÚNICAMENTE el fragmento intervenido de ${scopeDescription}. Devuelve solo el objeto JSON sin bloques de markdown envolventes.`;

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

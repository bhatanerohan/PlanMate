// mcp/agents/base-agent.ts - FIXED VERSION WITH ERROR HANDLING
import { OpenAI } from 'openai';
import { AgentContext, AgentMessage } from '../lib/types.js';

export abstract class BaseAgent {
  protected name: string;
  protected openai: OpenAI;
  protected context: AgentContext | null = null;

  constructor(name: string, openaiApiKey: string) {
    this.name = name;
    this.openai = new OpenAI({ apiKey: openaiApiKey });
  }

  abstract process(message: AgentMessage): Promise<any>;

  setContext(context: AgentContext) {
    this.context = context;
  }

  protected async callGPT(systemPrompt: string, userPrompt: string, jsonMode = true): Promise<any> {
    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini', // Use gpt-4o-mini for faster responses and lower cost
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        temperature: 0.7,
        max_tokens: 2000
      });

      const content = response.choices[0].message.content;
      
      if (!content) {
        console.error(`[${this.name}] GPT returned empty content`);
        return jsonMode ? {} : '';
      }

      if (jsonMode) {
        try {
          // Try to parse JSON
          return JSON.parse(content);
        } catch (parseError) {
          console.error(`[${this.name}] Failed to parse GPT JSON response:`, content);
          
          // Try to fix common JSON issues
          let fixedContent = content;
          
          // Remove any text before first { or [
          const jsonStart = Math.min(
            fixedContent.indexOf('{') !== -1 ? fixedContent.indexOf('{') : Infinity,
            fixedContent.indexOf('[') !== -1 ? fixedContent.indexOf('[') : Infinity
          );
          
          if (jsonStart !== Infinity) {
            fixedContent = fixedContent.substring(jsonStart);
          }
          
          // Remove any text after last } or ]
          const lastBrace = fixedContent.lastIndexOf('}');
          const lastBracket = fixedContent.lastIndexOf(']');
          const jsonEnd = Math.max(lastBrace, lastBracket);
          
          if (jsonEnd !== -1) {
            fixedContent = fixedContent.substring(0, jsonEnd + 1);
          }
          
          try {
            return JSON.parse(fixedContent);
          } catch (secondError) {
            console.error(`[${this.name}] Could not fix JSON, returning empty object`);
            return {};
          }
        }
      }
      
      return content;
    } catch (error: any) {
      console.error(`[${this.name}] GPT call failed:`, error.message);
      
      // Return sensible defaults
      if (jsonMode) {
        return {};
      }
      return '';
    }
  }

  protected log(message: string, data?: any) {
    if (data !== undefined) {
      console.log(`[${this.name}] ${message}`, data);
    } else {
      console.log(`[${this.name}] ${message}`);
    }
  }
}
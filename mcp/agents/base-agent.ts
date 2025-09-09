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
        model: 'gpt-4o',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        response_format: jsonMode ? { type: 'json_object' } : undefined,
        temperature: 0.7,
        max_tokens: 2000
      });

      const content = response.choices[0].message.content;
      return jsonMode ? JSON.parse(content!) : content;
    } catch (error) {
      console.error(`[${this.name}] GPT call failed:`, error);
      throw error;
    }
  }

  protected log(message: string, data?: any, p0?: string) {
    console.log(`[${this.name}] ${message}`, data || '');
  }
}
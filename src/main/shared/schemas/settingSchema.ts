import { z } from 'zod';

export const settingSchema = z.object({
  model_name: z.string().optional(),
  api_url: z.string().optional(),
  api_key: z.string().optional(),
  streaming: z.boolean().optional(),
  max_tokens: z.number().optional(),
  temperature: z.number().optional(),
  worldBookPath: z.string().optional(),
  characterPath: z.string().optional(),
  avatarPath: z.string().optional(),
  creativePath: z.string().optional(),
  memoryPath: z.string().optional(),
  pluginPath: z.string().optional(),
  logLevel: z.string().optional(),
  dashboardBackgroundImage: z.string().optional(),
  animationEnabled: z.boolean().optional(),
  compactMode: z.boolean().optional(),
  activeEngineId: z.string().optional(),
  defaultEngineId: z.string().optional(),
});
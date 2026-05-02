import { FastifyInstance } from 'fastify';
import { settingService } from '../settingService';

export async function settingRoutes(fastify: FastifyInstance) {
  fastify.get('/api/setting', async (request, reply) => {
    const setting = await settingService.readSetting();
    return setting;
  });

  fastify.post('/api/setting', async (request, reply) => {
    const setting = request.body as any;
    const result = await settingService.writeSetting(setting);
    return result;
  });

  fastify.post('/api/setting/validate', async (request, reply) => {
    const setting = request.body as any;
    const result = await settingService.validateSetting(setting);
    return result;
  });
}
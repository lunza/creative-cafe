import { FastifyInstance } from 'fastify';
import { characterService } from '../characterService';

export async function characterRoutes(fastify: FastifyInstance) {
  fastify.get('/api/characters', async (request, reply) => {
    const characters = await characterService.listCharacters();
    return characters;
  });

  fastify.get<{ Params: { path: string } }>('/api/characters/:path', async (request, reply) => {
    const { path } = request.params;
    const character = await characterService.readCharacter(path);
    return character;
  });

  fastify.post<{ Params: { path: string } }>('/api/characters/:path', async (request, reply) => {
    const { path } = request.params;
    const data = request.body as any;
    const result = await characterService.writeCharacter(path, data);
    return result;
  });

  fastify.delete<{ Params: { path: string } }>('/api/characters/:path', async (request, reply) => {
    const { path } = request.params;
    const result = await characterService.deleteCharacter(path);
    return result;
  });

  fastify.post<{ Params: { path: string } }>('/api/characters/:path/optimize', async (request, reply) => {
    const { path } = request.params;
    const result = await characterService.optimizeCharacter(path);
    return result;
  });
}

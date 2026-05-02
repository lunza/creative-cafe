import { FastifyInstance } from 'fastify';
import { worldBookService } from '../worldBookService';

export async function worldBookRoutes(fastify: FastifyInstance) {
  fastify.get('/api/worldbooks', async (request, reply) => {
    const worldBooks = await worldBookService.listWorldBooks();
    return worldBooks;
  });

  fastify.get<{ Params: { path: string } }>('/api/worldbooks/:path', async (request, reply) => {
    const { path } = request.params;
    const worldBook = await worldBookService.readWorldBook(path);
    return worldBook;
  });

  fastify.post<{ Params: { path: string } }>('/api/worldbooks/:path', async (request, reply) => {
    const { path } = request.params;
    const data = request.body as any;
    const result = await worldBookService.writeWorldBook(path, data);
    return result;
  });

  fastify.delete<{ Params: { path: string } }>('/api/worldbooks/:path', async (request, reply) => {
    const { path } = request.params;
    const result = await worldBookService.deleteWorldBook(path);
    return result;
  });

  fastify.post<{ Params: { path: string } }>('/api/worldbooks/:path/optimize', async (request, reply) => {
    const { path } = request.params;
    const result = await worldBookService.optimizeWorldBook(path);
    return result;
  });
}

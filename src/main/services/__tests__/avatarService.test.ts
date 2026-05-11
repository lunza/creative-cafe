import { describe, it, expect } from 'vitest';
import path from 'path';

describe('AvatarService Path Configuration', () => {
  it('should use getUserDataPath() and construct path with data/avatars', async () => {
    const { avatarService } = await import('../../services/avatarService');
    const avatarDir = avatarService.getAvatarDir();

    expect(avatarDir).toContain('data');
    expect(avatarDir).toContain('avatars');
    expect(avatarDir).not.toContain('user-avatars');
    expect(path.isAbsolute(avatarDir)).toBe(true);
  });

  it('should not use project working directory as base path', async () => {
    const { avatarService } = await import('../../services/avatarService');
    const avatarDir = avatarService.getAvatarDir();

    const cwd = process.cwd();
    const expectedWrongPath = path.join(cwd, 'data', 'avatars');
    
    expect(avatarDir).not.toBe(expectedWrongPath);
  });
});

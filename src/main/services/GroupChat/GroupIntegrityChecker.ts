import fs from 'fs';

export class GroupIntegrityChecker {
  private static instance: GroupIntegrityChecker;

  private constructor() {}

  static getInstance(): GroupIntegrityChecker {
    if (!GroupIntegrityChecker.instance) {
      GroupIntegrityChecker.instance = new GroupIntegrityChecker();
    }
    return GroupIntegrityChecker.instance;
  }

  checkIntegrity(filePath: string, expectedIntegrity: string | undefined): boolean {
    if (!expectedIntegrity) {
      return true;
    }

    if (!fs.existsSync(filePath)) {
      return true;
    }

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const lines = content.split('\n').filter((line) => line.trim());

      if (lines.length === 0) {
        return true;
      }

      const firstLine = lines[0];
      const header = JSON.parse(firstLine);

      if (!header.chat_metadata || !header.chat_metadata.integrity) {
        return true;
      }

      return header.chat_metadata.integrity === expectedIntegrity;
    } catch (error) {
      console.error('Integrity check failed:', error);
      return false;
    }
  }
}

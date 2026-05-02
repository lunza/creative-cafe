class OptimizerService {
  async optimizeWorldBook(data: any) {
    let optimized = { ...data };

    optimized = this.removeDuplicates(optimized);
    optimized = this.formatContent(optimized);
    optimized = this.validateStructure(optimized);

    return optimized;
  }

  async optimizeCharacter(data: any) {
    let optimized = { ...data };

    optimized = this.normalizeCharacterData(optimized);
    optimized = this.fillMissingFields(optimized);
    optimized = this.formatCharacterContent(optimized);

    return optimized;
  }

  private removeDuplicates(data: any) {
    if (!data.entries) return data;

    const seen = new Set();
    data.entries = data.entries.filter((entry: any) => {
      const key = entry.key || entry.content;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    return data;
  }

  private formatContent(data: any) {
    if (!data.entries) return data;

    data.entries = data.entries.map((entry: any) => ({
      ...entry,
      content: entry.content?.trim() || '',
      key: entry.key?.trim() || ''
    }));

    return data;
  }

  private validateStructure(data: any) {
    if (!data.entries) {
      data.entries = [];
    }

    if (!data.metadata) {
      data.metadata = {};
    }

    return data;
  }

  private normalizeCharacterData(data: any) {
    if (!data.name) data.name = 'Unknown';
    if (!data.description) data.description = '';
    if (!data.personality) data.personality = '';

    return data;
  }

  private fillMissingFields(data: any) {
    const requiredFields = ['name', 'description', 'personality', 'scenario'];
    requiredFields.forEach(field => {
      if (!data[field]) {
        data[field] = '';
      }
    });

    return data;
  }

  private formatCharacterContent(data: any) {
    const textFields = ['description', 'personality', 'scenario', 'mes_example'];
    textFields.forEach(field => {
      if (data[field] && typeof data[field] === 'string') {
        data[field] = data[field].trim();
      }
    });

    return data;
  }

  calculateQualityScore(data: any): number {
    let score = 0;
    const maxScore = 100;

    if (data.name) score += 20;
    if (data.description && data.description.length > 50) score += 20;
    if (data.personality && data.personality.length > 30) score += 20;
    if (data.scenario && data.scenario.length > 30) score += 20;
    if (data.mes_example && data.mes_example.length > 50) score += 20;

    return Math.min(score, maxScore);
  }
}

export const optimizerService = new OptimizerService();

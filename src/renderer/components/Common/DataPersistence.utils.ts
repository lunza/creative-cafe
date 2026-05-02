import { ValidationResult, DataPersistenceError } from './DataPersistence.types';

// 数据验证函数
export const validateData = (data: any, schema?: any): ValidationResult => {
  try {
    if (!schema) {
      // 没有 schema 时，接受所有有效类型（包括字符串）
      return { valid: true, data };
    }
    
    // 这里可以集成Zod等验证库
    // 暂时使用简单的验证
    if (typeof data !== 'object' || data === null) {
      // 允许非对象类型，比如字符串
      return { valid: true, data };
    }
    
    return { valid: true, data };
  } catch (error) {
    return {
      valid: false,
      errors: [error instanceof Error ? error.message : '验证失败']
    };
  }
};

// 错误处理函数
export const createError = (code: string, message: string, details?: any): DataPersistenceError => {
  return {
    code,
    message,
    details
  };
};

// 深拷贝函数
export const deepClone = <T>(obj: T): T => {
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }
  
  if (obj instanceof Date) {
    return new Date(obj.getTime()) as unknown as T;
  }
  
  if (obj instanceof Array) {
    return obj.map(item => deepClone(item)) as unknown as T;
  }
  
  if (typeof obj === 'object') {
    const clonedObj = {} as T;
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        clonedObj[key] = deepClone(obj[key]);
      }
    }
    return clonedObj;
  }
  
  return obj;
};

// 生成唯一ID
export const generateId = (prefix?: string): string => {
  const timestamp = Date.now().toString();
  const random = Math.random().toString(36).substring(2, 9);
  return `${prefix || 'id'}_${timestamp}_${random}`;
};

// 格式化日期
export const formatDate = (date: Date = new Date()): string => {
  return date.toISOString();
};

// 检查数据是否存在
export const isDataValid = (data: any): boolean => {
  return data !== null && data !== undefined;
};

// 批量操作工具
export const batchOperation = <T>(
  items: Record<string, T>,
  operation: (item: T) => T
): Record<string, T> => {
  const result: Record<string, T> = {};
  for (const key in items) {
    if (items.hasOwnProperty(key)) {
      result[key] = operation(items[key]);
    }
  }
  return result;
};

// 数据导出工具
export const exportData = (data: any): string => {
  try {
    return JSON.stringify(data, null, 2);
  } catch (error) {
    console.error('数据导出失败:', error);
    throw error;
  }
};

// 数据导入工具
export const importData = (dataString: string): any => {
  try {
    return JSON.parse(dataString);
  } catch (error) {
    console.error('数据导入失败:', error);
    throw error;
  }
};

// 数据清理工具
export const cleanData = (data: any): any => {
  if (data === null || typeof data !== 'object') {
    return data;
  }
  
  if (Array.isArray(data)) {
    return data.filter(item => item !== null && item !== undefined).map(cleanData);
  }
  
  const cleaned: any = {};
  for (const key in data) {
    if (data.hasOwnProperty(key)) {
      const value = data[key];
      if (value !== null && value !== undefined) {
        cleaned[key] = cleanData(value);
      }
    }
  }
  return cleaned;
};

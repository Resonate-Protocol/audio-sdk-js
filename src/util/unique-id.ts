export const generateUniqueId = (prefix: string): string =>
  `${prefix}_${Math.random().toString(36).substring(2, 9)}`;

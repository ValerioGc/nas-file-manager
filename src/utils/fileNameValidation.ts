export type FileNameValidationError =
  'nameRequired' | 'invalidName' | 'reservedName' | 'nameTooLong' | 'fileExtensionRequired';

const invalidCharacters = /[<>:"/\\|?*]/;
const reservedNames = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

export function validateFileName(
  name: string,
  requireExtension = false,
): FileNameValidationError | null {
  if (!name.trim()) {
    return 'nameRequired';
  }
  if (name === '.' || name === '..' || reservedNames.test(name)) {
    return 'reservedName';
  }
  if (name.length > 255) {
    return 'nameTooLong';
  }
  if (invalidCharacters.test(name) || hasControlCharacter(name) || /[. ]$/.test(name)) {
    return 'invalidName';
  }
  if (requireExtension && !hasFileExtension(name)) {
    return 'fileExtensionRequired';
  }
  return null;
}

function hasFileExtension(name: string) {
  const extensionSeparator = name.lastIndexOf('.');
  return extensionSeparator > 0 && extensionSeparator < name.length - 1;
}

function hasControlCharacter(name: string) {
  return [...name].some((character) => (character.codePointAt(0) ?? 0) < 32);
}

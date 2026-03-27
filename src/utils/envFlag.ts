export function isEnabledEnvValue(value: string | undefined): boolean {
    return ['true', '1', 'yes'].includes(value?.toLowerCase() || '');
}

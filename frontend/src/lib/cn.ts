/** Une clases condicionales sin arrastrar una dependencia para ello. */
export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ')
}

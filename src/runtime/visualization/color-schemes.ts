export const NODE_COLORS: Record<string, string> = {
  Person: '#5C10F4',
  Organization: '#A550FF',
  Location: '#0DFF00',
  Product: '#FFD700',
  Concept: '#FF6B6B',
  Event: '#00C8FF',
  Role: '#FF9500',
  Fact: '#90EE90',
  default: '#D3D3D3',
};

export function getNodeColor(type: string): string {
  return NODE_COLORS[type] || NODE_COLORS.default;
}

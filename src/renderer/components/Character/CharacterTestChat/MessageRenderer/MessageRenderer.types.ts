export interface MessageRendererProps {
  content: string;
  charName?: string;
  userName?: string;
  config?: Partial<import('./MessageRenderer.config').RenderConfig>;
  className?: string;
  style?: React.CSSProperties;
  onLinkClick?: (href: string, event: React.MouseEvent) => void;
  onImageClick?: (src: string, event: React.MouseEvent) => void;
}

export interface MessageRendererInternalProps extends MessageRendererProps {
  processedContent: string;
}

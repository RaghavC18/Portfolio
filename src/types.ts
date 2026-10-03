export interface VideoReel {
  id: string;
  title: string;
  category: string;
  duration: string;
  aspect: '9:16' | '16:9';
  videoUrl?: string; // Blob URL or http URL or /uploads/ URL
  serverVideoUrl?: string; // Persistent server URL (/uploads/...)
  fileName?: string;
  bgGradientClass: string;
  isWide?: boolean;
}

export interface PortfolioInfo {
  kicker: string;
  titleLine1: string;
  titleHighlight: string;
  tagline: string;
  aboutText: string;
  skills: string[];
  email: string;
  instagram: string;
  availability: string;
  portraitUrl?: string;
}

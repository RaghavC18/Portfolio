import React, { useEffect, useState } from 'react';
import { VideoReel, PortfolioInfo } from './types';
import VideoPortfolioView from './components/VideoPortfolioView';
import {
  fetchServerPortfolio,
  saveServerPortfolio,
} from './utils/api';

const INITIAL_PORTFOLIO_INFO: PortfolioInfo = {
  kicker: 'FREELANCE VIDEO EDITOR . 24 FPS . 4K',
  titleLine1: 'EVERY FRAME',
  titleHighlight: 'MATTERS',
  tagline: 'EDITS WITH RHYTHM. STORIES WITH SOUL',
  aboutText:
    'I turn raw footage into sharp, engaging visual stories. I care about rhythm, timing, atmosphere and the details that make an edit feel alive.',
  skills: [
    'Color Grading',
    'Sound Design',
    'VFX',
    'Speed Ramping',
    'Motion Graphics',
  ],
  email: 'SAMPLE',
  instagram: 'SAMPLE',
  availability: 'AVAILABLE FOR WORK',
};

const INITIAL_VIDEO_REELS: VideoReel[] = [
  {
    id: 'reel_1',
    title: 'CINEMATIC SHOWREEL',
    category: 'Commercial · Showreel',
    duration: '00:45',
    aspect: '9:16',
    videoUrl: '',
    serverVideoUrl: '',
    bgGradientClass: 'one',
    isWide: false,
  },
  {
    id: 'reel_2',
    title: 'URBAN FASHION REEL',
    category: 'Fashion · Promo',
    duration: '00:30',
    aspect: '9:16',
    videoUrl: '',
    serverVideoUrl: '',
    bgGradientClass: 'two',
    isWide: false,
  },
];

export default function App() {
  const [info, setInfo] = useState<PortfolioInfo>(
    INITIAL_PORTFOLIO_INFO
  );
  const [reels, setReels] = useState<VideoReel[]>(
    INITIAL_VIDEO_REELS
  );
  const [isLoading, setIsLoading] =
    useState(true);

  useEffect(() => {
    let mounted = true;

    const load = async () => {
      try {
        const data =
          await fetchServerPortfolio();

        if (
          mounted &&
          data?.info &&
          Array.isArray(data.reels)
        ) {
          setInfo(data.info);
          setReels(data.reels);
        }
      } catch (error) {
        console.warn(
          'Portfolio data is not available yet; using local defaults.',
          error
        );
      } finally {
        if (mounted) {
          setIsLoading(false);
        }
      }
    };

    load();

    return () => {
      mounted = false;
    };
  }, []);

  const handleUpdateInfo = async (
    newInfo: PortfolioInfo
  ) => {
    setInfo(newInfo);

    try {
      await saveServerPortfolio(
        newInfo,
        reels
      );
    } catch (error) {
      console.error(
        'Failed to save portfolio info:',
        error
      );
    }
  };

  const handleUpdateReels = async (
    newReels: VideoReel[]
  ) => {
    setReels(newReels);

    try {
      await saveServerPortfolio(
        info,
        newReels
      );
    } catch (error) {
      console.error(
        'Failed to save portfolio reels:',
        error
      );
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-black text-white flex items-center justify-center font-sans">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
          <span className="text-xs text-neutral-400 tracking-wider uppercase font-mono">
            Loading Studio Portfolio...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white selection:bg-red-600 selection:text-white font-sans antialiased">
      <VideoPortfolioView
        info={info}
        reels={reels}
        onUpdateInfo={handleUpdateInfo}
        onUpdateReels={handleUpdateReels}
      />
    </div>
  );
}

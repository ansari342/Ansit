import React, { useState, useEffect } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { HomeScreen } from './src/components/HomeScreen';
import { NowPlayingScreen } from './src/components/NowPlayingScreen';
import { LoopSettingsModal } from './src/components/LoopSettingsModal';
import { Surah, Reciter, LoopSettings } from './src/types';
import { SURAHS } from './src/data/surahs';
import { RECITERS } from './src/data/reciters';
import { stopAndUnloadAudio, initAudioMode } from './src/services/audioService';
import { SoundwaveVisualizer } from './src/components/SoundwaveVisualizer';
import { BouncyTouchable } from './src/components/BouncyTouchable';
import { LandingScreen } from './src/components/LandingScreen';
import { HistoryItem, getRecentlyPlayed } from './src/services/historyService';
import {
  saveLastSession,
  getLastSession,
} from './src/services/sessionStorage';

export default function App() {
  const [showLanding, setShowLanding] = useState<boolean>(true);
  const [mostRecentHistoryItem, setMostRecentHistoryItem] = useState<HistoryItem | null>(null);
  const [currentScreen, setCurrentScreen] = useState<'home' | 'nowPlaying'>('home');
  const [sessionLoaded, setSessionLoaded] = useState<boolean>(false);

  const initialSurah = SURAHS.find(s => s.number === 1) || SURAHS[0];
  const [session, setSession] = useState<{
    surah: Surah;
    fromVerse: number;
    toVerse: number;
    reciter: Reciter;
  }>({
    surah: initialSurah,
    fromVerse: 1,
    toVerse: initialSurah.numberOfAyahs,
    reciter: RECITERS[0],
  });

  useEffect(() => {
    initAudioMode();

    // 1. Load recently played list
    getRecentlyPlayed().then(list => {
      if (list && list.length > 0) {
        setMostRecentHistoryItem(list[0]);
      }
    });

    // 2. Load last selected session
    getLastSession().then(saved => {
      if (saved) {
        const surah = SURAHS.find(s => s.number === saved.surahNumber);
        const reciter = RECITERS.find(r => r.id === saved.reciterId) || RECITERS[0];
        if (surah) {
          const safeFrom = Math.max(1, Math.min(saved.fromVerse, surah.numberOfAyahs));
          const safeTo = Math.max(safeFrom, Math.min(saved.toVerse, surah.numberOfAyahs));
          const restoredSession = {
            surah,
            fromVerse: safeFrom,
            toVerse: safeTo,
            reciter,
          };
          setSession(restoredSession);

          // Seed LandingScreen suggestion with the restored session
          setMostRecentHistoryItem({
            id: `${surah.number}_${safeFrom}_${safeTo}_${reciter.id}`,
            surahNumber: surah.number,
            surahName: surah.englishName,
            surahArabicName: surah.name,
            fromVerse: safeFrom,
            toVerse: safeTo,
            reciterId: reciter.id,
            reciterName: reciter.shortName,
            timestamp: saved.timestamp || Date.now(),
          });
        }
      }
      setSessionLoaded(true);
    });
  }, []);

  const [hasStartedPlaying, setHasStartedPlaying] = useState<boolean>(false);

  const [playbackState, setPlaybackState] = useState<{
    isPlaying: boolean;
    currentVerseNum: number;
    togglePlayPause: () => void;
    currentReciterName?: string;
  }>({
    isPlaying: false,
    currentVerseNum: 1,
    togglePlayPause: () => {},
  });

  const [loopSettings, setLoopSettings] = useState<LoopSettings>({
    mode: 'range',
    verseRepeatCount: 1,
    playbackSpeed: 1.0,
    delayBetweenVersesSeconds: 0,
  });

  const [settingsModalVisible, setSettingsModalVisible] = useState<boolean>(false);

  const handleStartPlayback = (
    surah: Surah,
    fromVerse: number,
    toVerse: number,
    reciter: Reciter
  ) => {
    const newSession = {
      surah,
      fromVerse,
      toVerse,
      reciter,
    };
    setSession(newSession);
    saveLastSession(surah.number, fromVerse, toVerse, reciter.id);
    setHasStartedPlaying(true);
    setCurrentScreen('nowPlaying');
  };

  const handleToggleMiniPlayPause = () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    } catch (e) {}
    playbackState.togglePlayPause();
  };

  const handleStopAndCloseMiniPlayer = async () => {
    try {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    } catch (e) {}
    await stopAndUnloadAudio();
    setHasStartedPlaying(false);
  };

  return (
    <View style={styles.container}>
      <StatusBar style="light" />

      {/* HOME SCREEN VIEW */}
      <View
        style={[
          styles.screenWrapper,
          currentScreen !== 'home' && styles.screenHidden,
        ]}
      >
        <HomeScreen
          onStartPlayback={handleStartPlayback}
          onOpenSettings={() => setSettingsModalVisible(true)}
          activeSession={sessionLoaded ? session : undefined}
          onSelectionChange={(surah, fromVerse, toVerse, reciter) => {
            setSession({ surah, fromVerse, toVerse, reciter });
          }}
        />

        {/* MINIMIZED PLAYER BAR ON HOME SCREEN */}
        {hasStartedPlaying && (
          <View style={styles.miniPlayer}>
            {/* Tappable body to expand player */}
            <TouchableOpacity
              style={styles.miniPlayerBody}
              activeOpacity={0.8}
              onPress={() => setCurrentScreen('nowPlaying')}
            >
              <SoundwaveVisualizer
                isPlaying={playbackState.isPlaying}
                color="#9bbfff"
                barCount={4}
                maxHeight={18}
              />
              <View style={styles.miniPlayerInfo}>
                <Text style={styles.miniPlayerTitle} numberOfLines={1}>
                  Surah {session.surah.englishName}
                </Text>
                <Text style={styles.miniPlayerSubtitle} numberOfLines={1}>
                  Verse {playbackState.currentVerseNum}/{session.toVerse} •{' '}
                  {session.reciter.id === 'multiple'
                    ? `Multiple (${playbackState.currentReciterName || 'Mishary'})`
                    : session.reciter.shortName}
                </Text>
              </View>
            </TouchableOpacity>

            {/* DIRECT PLAY / PAUSE BUTTON WITH BOUNCY FEEDBACK */}
            <BouncyTouchable
              style={styles.miniPlayerPlayBtn}
              onPress={handleToggleMiniPlayPause}
            >
              <Ionicons
                name={playbackState.isPlaying ? 'pause' : 'play'}
                size={20}
                color="#0a101d"
                style={!playbackState.isPlaying ? { marginLeft: 2 } : undefined}
              />
            </BouncyTouchable>

            {/* CLOSE / STOP BUTTON */}
            <TouchableOpacity
              style={styles.miniPlayerCloseBtn}
              activeOpacity={0.7}
              onPress={handleStopAndCloseMiniPlayer}
            >
              <Ionicons name="close" size={20} color="#718096" />
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* NOW PLAYING SCREEN VIEW (Kept mounted so audio & preloader continue) */}
      {hasStartedPlaying && (
        <View
          style={[
            styles.screenWrapper,
            currentScreen !== 'nowPlaying' && styles.screenHidden,
          ]}
        >
          <NowPlayingScreen
            surah={session.surah}
            fromVerse={session.fromVerse}
            toVerse={session.toVerse}
            reciter={session.reciter}
            initialLoopSettings={loopSettings}
            onMinimize={() => setCurrentScreen('home')}
            onPlaybackStateChange={setPlaybackState}
          />
        </View>
      )}

      {/* Global Settings Modal */}
      <LoopSettingsModal
        visible={settingsModalVisible}
        settings={loopSettings}
        onUpdateSettings={setLoopSettings}
        onClose={() => setSettingsModalVisible(false)}
      />

      {/* DELIGHTFUL LANDING SCREEN (Swipe up to enter) */}
      {showLanding && (
        <LandingScreen
          onEnter={() => setShowLanding(false)}
          recentItem={mostRecentHistoryItem}
          onPlayRecent={(item) => {
            const surah = SURAHS.find(s => s.number === item.surahNumber);
            const reciter =
              RECITERS.find(r => r.id === item.reciterId) || RECITERS[0];
            if (surah) {
              setShowLanding(false);
              handleStartPlayback(surah, item.fromVerse, item.toVerse, reciter);
            }
          }}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#080b11',
  },
  screenWrapper: {
    flex: 1,
  },
  screenHidden: {
    position: 'absolute',
    top: -9999,
    left: -9999,
    width: 0,
    height: 0,
    opacity: 0,
  },
  miniPlayer: {
    position: 'absolute',
    bottom: 24,
    left: 16,
    right: 16,
    backgroundColor: '#121726',
    borderRadius: 18,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#222f47',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.5,
    shadowRadius: 10,
    elevation: 10,
  },
  miniPlayerBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  miniPlayerDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#526079',
    marginRight: 10,
  },
  miniPlayerDotActive: {
    backgroundColor: '#8cb3ff',
    shadowColor: '#8cb3ff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.9,
    shadowRadius: 4,
  },
  miniPlayerInfo: {
    flex: 1,
    paddingRight: 8,
  },
  miniPlayerTitle: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
  },
  miniPlayerSubtitle: {
    color: '#8a95aa',
    fontSize: 12,
    marginTop: 1,
  },
  miniPlayerPlayBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#9bbfff',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 6,
    shadowColor: '#9bbfff',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  miniPlayerCloseBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#161e2f',
    alignItems: 'center',
    justifyContent: 'center',
  },
});

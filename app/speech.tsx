"use client";

import { useCallback, useEffect, useState } from "react";

const voiceStorageKey = "bloom-english:speech-voice";
const rateStorageKey = "bloom-english:speech-rate";

export type SpeechController = {
  voices: SpeechSynthesisVoice[];
  voiceURI: string;
  rate: number;
  message: string;
  setVoice: (voiceURI: string) => void;
  setRate: (rate: number) => void;
  speak: (text: string, label?: string) => void;
};

export function useSpeech(): SpeechController {
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [voiceURI, setVoiceURI] = useState("");
  const [rate, setRateValue] = useState(1);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const savedVoice = window.localStorage.getItem(voiceStorageKey) ?? "";
    const savedRate = Number(window.localStorage.getItem(rateStorageKey));
    if (savedRate >= 0.6 && savedRate <= 1.4) setRateValue(savedRate);
    setVoiceURI(savedVoice);

    if (!("speechSynthesis" in window)) return;
    const refreshVoices = () => {
      const englishVoices = window.speechSynthesis.getVoices()
        .filter((voice) => voice.lang.toLowerCase().startsWith("en"));
      setVoices(englishVoices);
      setVoiceURI((current) => current || savedVoice || englishVoices.find((voice) => voice.lang.toLowerCase() === "en-us")?.voiceURI || "");
    };
    refreshVoices();
    window.speechSynthesis.addEventListener("voiceschanged", refreshVoices);
    return () => window.speechSynthesis.removeEventListener("voiceschanged", refreshVoices);
  }, []);

  const setVoice = useCallback((nextVoiceURI: string) => {
    setVoiceURI(nextVoiceURI);
    window.localStorage.setItem(voiceStorageKey, nextVoiceURI);
  }, []);

  const setRate = useCallback((nextRate: number) => {
    setRateValue(nextRate);
    window.localStorage.setItem(rateStorageKey, String(nextRate));
  }, []);

  const speak = useCallback((text: string, label = text) => {
    if (!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) {
      setMessage("このブラウザーは音声読み上げに対応していません。");
      return;
    }
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = voices.find((item) => item.voiceURI === voiceURI);
    utterance.lang = voice?.lang ?? "en-US";
    utterance.voice = voice ?? null;
    utterance.rate = rate;
    utterance.onstart = () => setMessage(`読み上げ中: ${label}`);
    utterance.onend = () => setMessage("");
    utterance.onerror = () => setMessage("音声を再生できませんでした。ブラウザーの音声設定をご確認ください。");
    window.speechSynthesis.speak(utterance);
  }, [rate, voiceURI, voices]);

  return { voices, voiceURI, rate, message, setVoice, setRate, speak };
}

export function SpeechSettings({ controller }: { controller: SpeechController }) {
  return (
    <div className="audio-settings" aria-label="音声設定">
      <label>
        <span>音声</span>
        <select value={controller.voiceURI} onChange={(event) => controller.setVoice(event.target.value)}>
          <option value="">自動 (English)</option>
          {controller.voices.map((voice) => (
            <option value={voice.voiceURI} key={voice.voiceURI}>{voice.name} · {voice.lang}</option>
          ))}
        </select>
      </label>
      <label>
        <span>速度</span>
        <select value={controller.rate} onChange={(event) => controller.setRate(Number(event.target.value))}>
          <option value={0.75}>ゆっくり</option>
          <option value={0.9}>ややゆっくり</option>
          <option value={1}>標準</option>
          <option value={1.1}>やや速く</option>
          <option value={1.25}>速く</option>
        </select>
      </label>
    </div>
  );
}

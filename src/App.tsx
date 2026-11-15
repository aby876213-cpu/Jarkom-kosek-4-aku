import { useState } from 'react';
import { ActivePeersPanel } from './components/ActivePeersPanel';
import { AudioSettingsPanel } from './components/AudioSettingsPanel';
import { CallLogPanel } from './components/CallLogPanel';
import { ChannelSelector } from './components/ChannelSelector';
import { NetworkInfoPanel } from './components/NetworkInfoPanel';
import { PttButton } from './components/PttButton';
import { TacticalHeader } from './components/TacticalHeader';
import { TextChatPanel } from './components/TextChatPanel';
import { UserBarcodeModal } from './components/UserBarcodeModal';
import { useTacticalComms } from './hooks/useTacticalComms';

export default function App() {
  const [isBarcodeModalOpen, setIsBarcodeModalOpen] = useState(false);

  const {
    channel,
    channelFreq,
    callsign,
    clientIp,
    socketConnected,
    pingMs,
    micStatus,
    micLevel,
    audioOutputBlocked,
    isTransmitting,
    txMode,
    rxActiveSender,
    voxEnabled,
    voxThreshold,
    gainLevel,
    overrideActive,
    talkAllActive,
    emergencyMode,
    peers,
    enrolledUsers,
    callLogs,
    logFilter,
    chatMessages,
    setVoxThreshold,
    setOverrideActive,
    setTalkAllActive,
    setLogFilter,
    updateCallsign,
    switchChannel,
    toggleEmergency,
    toggleVox,
    updateGain,
    startPTT,
    stopPTT,
    measurePing,
    sendChatText,
    playLogEntry,
    ensureAudioReady,
    unlockAudioOutput,
    enrollUserByBarcode,
    removeEnrolledUser,
  } = useTacticalComms();

  return (
    <div className="min-h-screen w-full flex justify-center items-start lg:items-center p-0 sm:p-4 lg:p-6 select-none">
      <main className="tactical-shell w-full max-w-[460px] lg:max-w-5xl min-h-screen sm:min-h-0 flex flex-col border-x sm:border border-cyan-500/35 sm:rounded-2xl shadow-[0_0_45px_rgba(0,240,255,0.14)] overflow-hidden">
        <TacticalHeader
          socketConnected={socketConnected}
          pingMs={pingMs}
          emergencyMode={emergencyMode}
        />

        <div className="p-3 sm:p-4 grid grid-cols-1 lg:grid-cols-12 gap-3 lg:gap-4 items-start">
          {/* Kolom Utama / Transceiver Mobile-First */}
          <div className="lg:col-span-6 space-y-3">
            <NetworkInfoPanel
              pingMs={pingMs}
              callsign={callsign}
              clientIp={clientIp}
              peerCount={peers.length}
              onCallsignChange={updateCallsign}
              onPingClick={measurePing}
            />

            <ChannelSelector
              channel={channel}
              channelFreq={channelFreq}
              emergencyMode={emergencyMode}
              onPrevChannel={() => switchChannel(channel - 1)}
              onNextChannel={() => switchChannel(channel + 1)}
              onToggleEmergency={toggleEmergency}
            />

            <AudioSettingsPanel
              voxEnabled={voxEnabled}
              voxThreshold={voxThreshold}
              gainLevel={gainLevel}
              overrideActive={overrideActive}
              talkAllActive={talkAllActive}
              onToggleVox={toggleVox}
              onVoxThresholdChange={setVoxThreshold}
              onGainChange={updateGain}
              onToggleOverride={() => setOverrideActive((prev) => !prev)}
              onToggleTalkAll={() => setTalkAllActive((prev) => !prev)}
            />

            <div className="lg:hidden">
              <ActivePeersPanel
                channel={channel}
                peers={peers}
                enrolledUsers={enrolledUsers}
                micStatus={micStatus}
                onEnableMic={ensureAudioReady}
                onOpenBarcodeModal={() => setIsBarcodeModalOpen(true)}
                onRemoveEnrolledUser={removeEnrolledUser}
                onSwitchChannel={switchChannel}
              />
            </div>

            <PttButton
              channel={channel}
              isTransmitting={isTransmitting}
              txMode={txMode}
              talkAllActive={talkAllActive}
              rxActiveSender={rxActiveSender}
              micLevel={micLevel}
              audioOutputBlocked={audioOutputBlocked}
              onUnlockAudio={unlockAudioOutput}
              onStartPTT={() => startPTT('tx')}
              onStopPTT={() => stopPTT('tx')}
            />
          </div>

          {/* Kolom Kanan (Log Panggilan, Active Peers Desktop, Text Chat) */}
          <div className="lg:col-span-6 space-y-3">
            <div className="hidden lg:block">
              <ActivePeersPanel
                channel={channel}
                peers={peers}
                enrolledUsers={enrolledUsers}
                micStatus={micStatus}
                onEnableMic={ensureAudioReady}
                onOpenBarcodeModal={() => setIsBarcodeModalOpen(true)}
                onRemoveEnrolledUser={removeEnrolledUser}
                onSwitchChannel={switchChannel}
              />
            </div>

            <CallLogPanel
              logs={callLogs}
              activeFilter={logFilter}
              onFilterChange={setLogFilter}
              onPlayEntry={playLogEntry}
            />

            <TextChatPanel
              channel={channel}
              messages={chatMessages}
              onSendMessage={sendChatText}
            />
          </div>
        </div>
      </main>

      <UserBarcodeModal
        isOpen={isBarcodeModalOpen}
        currentChannel={channel}
        currentCallsign={callsign}
        enrolledUsers={enrolledUsers}
        onClose={() => setIsBarcodeModalOpen(false)}
        onEnrollUser={enrollUserByBarcode}
        onSwitchChannel={switchChannel}
      />
    </div>
  );
}

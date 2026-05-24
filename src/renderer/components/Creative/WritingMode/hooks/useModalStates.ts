import { useState, useCallback } from 'react';

interface UseModalStatesResult {
  showSplitModal: boolean;
  showMergeModal: boolean;
  showHistoryModal: boolean;
  showPlotCheckModal: boolean;
  showLogicRecordsModal: boolean;
  showTablePreviewModal: boolean;
  showFixResultModal: boolean;
  splitCount: number;
  setSplitCount: (count: number) => void;
  splitMode: 'content' | 'empty';
  setShowSplitModal: (visible: boolean) => void;
  setShowMergeModal: (visible: boolean) => void;
  setShowHistoryModal: (visible: boolean) => void;
  setShowPlotCheckModal: (visible: boolean) => void;
  setShowLogicRecordsModal: (visible: boolean) => void;
  setShowTablePreviewModal: (visible: boolean) => void;
  setShowFixResultModal: (visible: boolean) => void;
}

export function useModalStates(): UseModalStatesResult {
  const [showSplitModal, setShowSplitModal] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [showPlotCheckModal, setShowPlotCheckModal] = useState(false);
  const [showLogicRecordsModal, setShowLogicRecordsModal] = useState(false);
  const [showTablePreviewModal, setShowTablePreviewModal] = useState(false);
  const [showFixResultModal, setShowFixResultModal] = useState(false);
  const [splitCount, setSplitCount] = useState(2);
  const [splitMode, setSplitMode] = useState<'content' | 'empty'>('content');

  return {
    showSplitModal,
    showMergeModal,
    showHistoryModal,
    showPlotCheckModal,
    showLogicRecordsModal,
    showTablePreviewModal,
    showFixResultModal,
    splitCount,
    setSplitCount,
    splitMode,
    setShowSplitModal,
    setShowMergeModal,
    setShowHistoryModal,
    setShowPlotCheckModal,
    setShowLogicRecordsModal,
    setShowTablePreviewModal,
    setShowFixResultModal,
  };
}

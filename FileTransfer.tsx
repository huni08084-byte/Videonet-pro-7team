/**
 * 파일 전송 컴포넌트
 * - P2P 파일 전송 (최소 대역폭 사용)
 * - SHA256 해시 검증
 * - 전송 시간 및 대역폭 측정
 * - 동영상 분석 (슬라이싱 기반 요약, GPT 인물 인식)
 */

import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  DocumentArrowUpIcon,
  DocumentArrowDownIcon,
  CheckCircleIcon,
  XCircleIcon,
  ClockIcon,
  SignalIcon,
  FilmIcon,
  MagnifyingGlassIcon,
} from '@heroicons/react/24/outline';
import axios from 'axios';
import toast from 'react-hot-toast';

interface FileTransferProps {
  roomId: string;
  socket: any; // Socket.IO 클라이언트
  myUserId: string;
}

interface TransferStats {
  fileName: string;
  fileSize: number;
  transferTime: number;
  bandwidth: number; // MB/s
  hash: string;
}

export default function FileTransfer({ roomId, socket, myUserId }: FileTransferProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isTransferring, setIsTransferring] = useState(false);
  const [progress, setProgress] = useState(0);
  const [transferStats, setTransferStats] = useState<TransferStats | null>(null);
  const [receivedFile, setReceivedFile] = useState<File | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verificationResult, setVerificationResult] = useState<any>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisResult, setAnalysisResult] = useState<any>(null);
  const [showVerificationModal, setShowVerificationModal] = useState(false);
  const [showAnalysisModal, setShowAnalysisModal] = useState(false);
  const [chatMessages, setChatMessages] = useState<Array<{role: 'user' | 'assistant', content: string}>>([]);
  const [chatInput, setChatInput] = useState('');
  const [isChatLoading, setIsChatLoading] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 파일 선택 핸들러
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setTransferStats(null);
      setVerificationResult(null);
      setAnalysisResult(null);
      toast.success(`파일 선택됨: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)} MB)`);
    }
  };

  // SHA256 해시 계산 (브라우저)
  const calculateHash = async (file: File): Promise<string> => {
    const buffer = await file.arrayBuffer();
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex;
  };

  // 파일 전송 (청크 기반)
  const sendFile = async () => {
    if (!selectedFile) return;

    setIsTransferring(true);
    setProgress(0);
    const startTime = Date.now();

    try {
      // 해시 계산
      toast('파일 해시 계산 중...', { icon: '🔐' });
      const fileHash = await calculateHash(selectedFile);

      // 청크 크기: 16KB (대역폭 최소화)
      const CHUNK_SIZE = 16 * 1024;
      const totalChunks = Math.ceil(selectedFile.size / CHUNK_SIZE);

      // 메타데이터 먼저 전송
      socket.emit('file_transfer_start', {
        roomId,
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        fileType: selectedFile.type,
        totalChunks,
        hash: fileHash,
      });

      // 청크 단위로 전송
      for (let i = 0; i < totalChunks; i++) {
        const start = i * CHUNK_SIZE;
        const end = Math.min(start + CHUNK_SIZE, selectedFile.size);
        const chunk = selectedFile.slice(start, end);

        // ArrayBuffer로 변환
        const buffer = await chunk.arrayBuffer();

        // Socket.IO로 전송 (binary 모드)
        socket.emit('file_chunk', {
          roomId,
          chunkIndex: i,
          data: buffer,
        });

        // 진행률 업데이트
        setProgress(((i + 1) / totalChunks) * 100);

        // 백프레셔 방지 (10ms 대기)
        await new Promise(resolve => setTimeout(resolve, 10));
      }

      // 전송 완료 신호
      socket.emit('file_transfer_end', { roomId });

      const endTime = Date.now();
      const transferTime = (endTime - startTime) / 1000; // 초
      const bandwidth = (selectedFile.size / 1024 / 1024) / transferTime; // MB/s

      setTransferStats({
        fileName: selectedFile.name,
        fileSize: selectedFile.size,
        transferTime,
        bandwidth,
        hash: fileHash,
      });

      toast.success(`파일 전송 완료! (${transferTime.toFixed(2)}초, ${bandwidth.toFixed(2)} MB/s)`);
    } catch (error) {
      console.error('파일 전송 실패:', error);
      toast.error('파일 전송에 실패했습니다');
    } finally {
      setIsTransferring(false);
    }
  };

  // 파일 수신 핸들러 (Socket.IO)
  React.useEffect(() => {
    if (!socket) return;

    let receivedChunks: ArrayBuffer[] = [];
    let fileMetadata: any = null;

    socket.on('file_transfer_start', (data: any) => {
      console.log('파일 수신 시작:', data);
      fileMetadata = data;
      receivedChunks = [];
      toast(`${data.fileName} 수신 중...`, { icon: '📥' });
    });

    socket.on('file_chunk', ({ chunkIndex, data }: any) => {
      receivedChunks[chunkIndex] = data;
      if (fileMetadata) {
        const progress = ((chunkIndex + 1) / fileMetadata.totalChunks) * 100;
        setProgress(progress);
      }
    });

    socket.on('file_transfer_end', () => {
      if (fileMetadata && receivedChunks.length > 0) {
        // 청크 합치기
        const blob = new Blob(receivedChunks, { type: fileMetadata.fileType });
        const file = new File([blob], fileMetadata.fileName, { type: fileMetadata.fileType });

        setReceivedFile(file);
        toast.success(`${fileMetadata.fileName} 수신 완료!`);

        // 자동 다운로드
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileMetadata.fileName;
        a.click();
        URL.revokeObjectURL(url);
      }
    });

    return () => {
      socket.off('file_transfer_start');
      socket.off('file_chunk');
      socket.off('file_transfer_end');
    };
  }, [socket]);

  // 파일 검증 (모달로 표시)
  const verifyFile = async () => {
    if (!selectedFile || !receivedFile) {
      toast.error('원본 파일과 수신 파일이 모두 필요합니다');
      return;
    }

    setIsVerifying(true);
    try {
      const formData = new FormData();
      formData.append('original_file', selectedFile);
      formData.append('received_file', receivedFile);

      const response = await axios.post('/api/video/verify', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setVerificationResult(response.data);
      setShowVerificationModal(true);

      if (response.data.is_valid) {
        toast.success('✅ 파일 검증 성공! 파일이 동일합니다.');
      } else {
        toast.error('❌ 파일 검증 실패! 파일이 다릅니다.');
      }
    } catch (error) {
      console.error('검증 실패:', error);
      toast.error('파일 검증에 실패했습니다');
    } finally {
      setIsVerifying(false);
    }
  };

  // 동영상 분석 (모달로 표시)
  const analyzeVideo = async () => {
    if (!selectedFile) {
      toast.error('분석할 동영상 파일을 선택하세요');
      return;
    }

    if (!selectedFile.type.includes('video')) {
      toast.error('동영상 파일만 분석할 수 있습니다');
      return;
    }

    setIsAnalyzing(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);

      toast('동영상 분석 중... (GPT Vision API 사용)', { icon: '🤖' });

      const response = await axios.post('/api/video/analyze', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });

      setAnalysisResult(response.data);

      // 초기 분석 결과를 채팅 메시지로 추가
      setChatMessages([
        {
          role: 'assistant',
          content: `동영상 분석이 완료되었습니다!\n\n${response.data.summary}\n\n추가로 궁금하신 점이 있으시면 질문해주세요.`
        }
      ]);

      setShowAnalysisModal(true);
      toast.success('동영상 분석 완료!');
    } catch (error) {
      console.error('분석 실패:', error);
      toast.error('동영상 분석에 실패했습니다');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // 추가 질문 처리
  const handleChatSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !analysisResult) return;

    const userMessage = chatInput.trim();
    setChatInput('');

    // 사용자 메시지 추가
    setChatMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    setIsChatLoading(true);
    try {
      // GPT API로 추가 질문 전송 (전체 채팅 히스토리 포함)
      const response = await axios.post('/api/video/chat', {
        question: userMessage,
        analysisResult: analysisResult,
        videoInfo: {
          filename: selectedFile?.name,
          duration: analysisResult.duration,
          resolution: analysisResult.resolution,
        },
        chatHistory: chatMessages  // 전체 대화 기록 전달
      });

      // AI 응답 추가
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: response.data.answer
      }]);
    } catch (error) {
      console.error('질문 처리 실패:', error);
      setChatMessages(prev => [...prev, {
        role: 'assistant',
        content: '죄송합니다. 질문 처리 중 오류가 발생했습니다.'
      }]);
    } finally {
      setIsChatLoading(false);
    }
  };

  return (
    <div className="bg-discord-light rounded-lg p-6 space-y-4">
      <h3 className="text-xl font-bold text-white flex items-center">
        <DocumentArrowUpIcon className="w-6 h-6 mr-2" />
        파일 전송
      </h3>

      {/* 파일 선택 */}
      <div>
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileSelect}
          className="hidden"
          accept="video/*,*/*"
        />
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full btn-discord"
        >
          파일 선택
        </button>
        {selectedFile && (
          <p className="text-sm text-gray-400 mt-2">
            선택됨: {selectedFile.name} ({(selectedFile.size / 1024 / 1024).toFixed(2)} MB)
          </p>
        )}
      </div>

      {/* 전송 버튼 */}
      {selectedFile && !isTransferring && (
        <button
          onClick={sendFile}
          className="w-full bg-green-600 hover:bg-green-700 text-white py-2 px-4 rounded-lg font-medium transition-colors"
        >
          파일 전송
        </button>
      )}

      {/* 진행바 */}
      {isTransferring && (
        <div className="space-y-2">
          <div className="w-full bg-discord-darker rounded-full h-4">
            <div
              className="bg-discord-brand h-4 rounded-full transition-all duration-300"
              style={{ width: `${progress}%` }}
            />
          </div>
          <p className="text-sm text-gray-400 text-center">{progress.toFixed(1)}%</p>
        </div>
      )}

      {/* 전송 통계 */}
      {transferStats && (
        <div className="bg-discord-darker rounded-lg p-4 space-y-2">
          <h4 className="font-semibold text-white flex items-center">
            <SignalIcon className="w-5 h-5 mr-2" />
            전송 통계
          </h4>
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>
              <span className="text-gray-400">파일 크기:</span>
              <span className="text-white ml-2">{(transferStats.fileSize / 1024 / 1024).toFixed(2)} MB</span>
            </div>
            <div>
              <span className="text-gray-400">전송 시간:</span>
              <span className="text-white ml-2">{transferStats.transferTime.toFixed(2)}초</span>
            </div>
            <div>
              <span className="text-gray-400">대역폭:</span>
              <span className="text-white ml-2">{transferStats.bandwidth.toFixed(2)} MB/s</span>
            </div>
            <div className="col-span-2">
              <span className="text-gray-400">SHA256:</span>
              <span className="text-white ml-2 text-xs font-mono">{transferStats.hash.substring(0, 16)}...</span>
            </div>
          </div>
        </div>
      )}

      {/* 검증 버튼 */}
      {selectedFile && receivedFile && (
        <button
          onClick={verifyFile}
          disabled={isVerifying}
          className="w-full bg-blue-600 hover:bg-blue-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50"
        >
          {isVerifying ? '검증 중...' : '파일 검증'}
        </button>
      )}

      {/* 검증 결과 */}
      {verificationResult && (
        <div className={`rounded-lg p-4 ${verificationResult.is_valid ? 'bg-green-900/30 border border-green-500' : 'bg-red-900/30 border border-red-500'}`}>
          <h4 className="font-semibold text-white flex items-center mb-2">
            {verificationResult.is_valid ? (
              <CheckCircleIcon className="w-5 h-5 mr-2 text-green-400" />
            ) : (
              <XCircleIcon className="w-5 h-5 mr-2 text-red-400" />
            )}
            검증 {verificationResult.is_valid ? '성공' : '실패'}
          </h4>
          <div className="text-sm space-y-1">
            <p className="text-gray-300">원본 해시: {verificationResult.original_hash.substring(0, 16)}...</p>
            <p className="text-gray-300">수신 해시: {verificationResult.received_hash.substring(0, 16)}...</p>
            <p className="text-gray-300">크기 일치: {verificationResult.file_size_match ? '✅' : '❌'}</p>
            <p className="text-gray-300">검증 시간: {verificationResult.verification_time.toFixed(2)}초</p>
          </div>
        </div>
      )}

      {/* 동영상 분석 버튼 */}
      {selectedFile && selectedFile.type.includes('video') && (
        <button
          onClick={analyzeVideo}
          disabled={isAnalyzing}
          className="w-full bg-purple-600 hover:bg-purple-700 text-white py-2 px-4 rounded-lg font-medium transition-colors disabled:opacity-50 flex items-center justify-center"
        >
          <FilmIcon className="w-5 h-5 mr-2" />
          {isAnalyzing ? '분석 중...' : '동영상 분석 (GPT Vision)'}
        </button>
      )}

      {/* 검증 결과 모달 */}
      <AnimatePresence>
        {showVerificationModal && verificationResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onClick={() => setShowVerificationModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-discord-light rounded-lg p-6 max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex justify-between items-center mb-4">
                <h2 className="text-2xl font-bold text-white flex items-center">
                  {verificationResult.is_valid ? (
                    <>
                      <CheckCircleIcon className="w-8 h-8 mr-2 text-green-400" />
                      검증 성공
                    </>
                  ) : (
                    <>
                      <XCircleIcon className="w-8 h-8 mr-2 text-red-400" />
                      검증 실패
                    </>
                  )}
                </h2>
                <button
                  onClick={() => setShowVerificationModal(false)}
                  className="text-gray-400 hover:text-white"
                >
                  <XMarkIcon className="w-6 h-6" />
                </button>
              </div>

              <div className={`rounded-lg p-6 ${verificationResult.is_valid ? 'bg-green-900/30 border border-green-500' : 'bg-red-900/30 border border-red-500'}`}>
                <div className="space-y-4">
                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">파일 크기 비교</h3>
                    <div className="grid grid-cols-2 gap-4 text-sm">
                      <div className="bg-discord-darker p-3 rounded">
                        <p className="text-gray-400 mb-1">원본 파일 크기</p>
                        <p className="text-white font-mono text-lg">{(verificationResult.original_size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <div className="bg-discord-darker p-3 rounded">
                        <p className="text-gray-400 mb-1">수신 파일 크기</p>
                        <p className="text-white font-mono text-lg">{(verificationResult.received_size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                    </div>
                    <div className="mt-3 text-center">
                      <span className={`font-bold ${verificationResult.file_size_match ? 'text-green-400' : 'text-red-400'}`}>
                        {verificationResult.file_size_match ? '✅ 크기 일치' : '❌ 크기 불일치'}
                      </span>
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-semibold text-white mb-2">SHA256 해시 비교</h3>
                    <div className="space-y-2 text-sm">
                      <div className="bg-discord-darker p-3 rounded">
                        <p className="text-gray-400 mb-1">원본 파일 해시</p>
                        <p className="text-white font-mono break-all">{verificationResult.original_hash}</p>
                      </div>
                      <div className="bg-discord-darker p-3 rounded">
                        <p className="text-gray-400 mb-1">수신 파일 해시</p>
                        <p className="text-white font-mono break-all">{verificationResult.received_hash}</p>
                      </div>
                    </div>
                    <div className="mt-3 text-center">
                      <span className={`font-bold ${verificationResult.original_hash === verificationResult.received_hash ? 'text-green-400' : 'text-red-400'}`}>
                        {verificationResult.original_hash === verificationResult.received_hash ? '✅ 해시 일치' : '❌ 해시 불일치'}
                      </span>
                    </div>
                  </div>

                  <div className="bg-discord-darker p-4 rounded">
                    <p className="text-gray-400 text-sm">검증 시간: <span className="text-white">{verificationResult.verification_time.toFixed(3)}초</span></p>
                  </div>

                  {verificationResult.is_valid ? (
                    <div className="bg-green-900/50 p-4 rounded border border-green-500">
                      <p className="text-green-100 text-center font-semibold">
                        🎉 파일이 완벽하게 일치합니다! 무손실 전송이 성공적으로 완료되었습니다.
                      </p>
                    </div>
                  ) : (
                    <div className="bg-red-900/50 p-4 rounded border border-red-500">
                      <p className="text-red-100 text-center font-semibold">
                        ⚠️ 파일이 손상되었거나 변경되었습니다. 다시 전송해주세요.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 분석 결과 챗봇 모달 */}
      <AnimatePresence>
        {showAnalysisModal && analysisResult && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
            onClick={() => setShowAnalysisModal(false)}
          >
            <motion.div
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className="bg-discord-light rounded-lg w-full max-w-4xl mx-4 h-[90vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* 헤더 */}
              <div className="flex justify-between items-center p-6 border-b border-gray-700">
                <h2 className="text-2xl font-bold text-white flex items-center">
                  <FilmIcon className="w-8 h-8 mr-2 text-purple-400" />
                  AI 동영상 분석 챗봇
                </h2>
                <div className="flex items-center space-x-2">
                  {chatMessages.length > 1 && (
                    <button
                      onClick={() => {
                        if (window.confirm('대화 기록을 초기화하시겠습니까?')) {
                          setChatMessages([chatMessages[0]]);  // 첫 메시지만 유지
                          toast.success('대화 기록이 초기화되었습니다');
                        }
                      }}
                      className="px-3 py-1 text-sm bg-red-600 hover:bg-red-700 text-white rounded transition-colors"
                      title="대화 초기화"
                    >
                      초기화
                    </button>
                  )}
                  <button
                    onClick={() => setShowAnalysisModal(false)}
                    className="text-gray-400 hover:text-white"
                  >
                    <XMarkIcon className="w-6 h-6" />
                  </button>
                </div>
              </div>

              {/* 채팅 메시지 영역 */}
              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {chatMessages.map((msg, idx) => (
                  <div
                    key={idx}
                    className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div
                      className={`max-w-[80%] rounded-lg p-4 ${
                        msg.role === 'user'
                          ? 'bg-discord-brand text-white'
                          : 'bg-discord-darker text-gray-100'
                      }`}
                    >
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  </div>
                ))}

                {isChatLoading && (
                  <div className="flex justify-start">
                    <div className="bg-discord-darker text-gray-100 rounded-lg p-4">
                      <div className="flex items-center space-x-2">
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                        <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* 입력 영역 */}
              <div className="p-4 border-t border-gray-700">
                <form onSubmit={handleChatSubmit} className="flex space-x-2">
                  <input
                    type="text"
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    placeholder="동영상에 대해 궁금한 점을 질문하세요..."
                    className="flex-1 input-field"
                    disabled={isChatLoading}
                  />
                  <button
                    type="submit"
                    disabled={!chatInput.trim() || isChatLoading}
                    className="px-6 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    전송
                  </button>
                </form>
                <p className="text-xs text-gray-500 mt-2">
                  예시: "이 동영상에 몇 명이 등장하나요?", "주요 장면을 설명해주세요", "등장 인물의 특징은?"
                </p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

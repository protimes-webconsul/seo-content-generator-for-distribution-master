
import React from 'react';

interface LoadingSpinnerProps {
  message?: string;
  subMessage?: string;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'AIが競合サイトを分析中です...',
  subMessage = 'これには1分ほどかかる場合があります。',
}) => {
  return (
    <div className="flex flex-col items-center justify-center p-16 bg-white rounded-xl border border-gray-200 shadow-sm">
      <div className="w-12 h-12 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
      <p className="mt-4 text-lg text-gray-700">{message}</p>
      {subMessage && <p className="text-sm text-gray-500">{subMessage}</p>}
    </div>
  );
};

export default LoadingSpinner;

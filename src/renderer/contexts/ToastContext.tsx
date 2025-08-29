import React, { createContext, useContext, useState, useCallback } from 'react';
import { ToastMessage } from '../components/Toast';

interface ToastContextType {
  showToast: (message: Omit<ToastMessage, 'id'>) => void;
  showSuccess: (message: string, duration?: number) => void;
  showError: (message: string, duration?: number) => void;
  showWarning: (message: string, duration?: number) => void;
  showInfo: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

export const useToast = () => {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
};

interface ToastProviderProps {
  children: React.ReactNode;
}

export const ToastProvider: React.FC<ToastProviderProps> = ({ children }) => {
  const [messages, setMessages] = useState<ToastMessage[]>([]);

  const showToast = useCallback((message: Omit<ToastMessage, 'id'>) => {
    const id = Math.random().toString(36).substring(7);
    setMessages((prev) => [...prev, { ...message, id }]);
  }, []);

  const showSuccess = useCallback((message: string, duration?: number) => {
    showToast({ type: 'success', message, duration });
  }, [showToast]);

  const showError = useCallback((message: string, duration?: number) => {
    showToast({ type: 'error', message, duration: duration || 7000 });
  }, [showToast]);

  const showWarning = useCallback((message: string, duration?: number) => {
    showToast({ type: 'warning', message, duration });
  }, [showToast]);

  const showInfo = useCallback((message: string, duration?: number) => {
    showToast({ type: 'info', message, duration });
  }, [showToast]);

  const removeToast = useCallback((id: string) => {
    setMessages((prev) => prev.filter((msg) => msg.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast, showSuccess, showError, showWarning, showInfo }}>
      {children}
      {/* Import ToastContainer dynamically to avoid circular dependency */}
      {messages.length > 0 && (
        <div className="fixed top-4 right-4 z-50 space-y-2">
          {messages.map((message) => (
            <div key={message.id}>
              {/* We'll render Toast components here directly */}
              <ToastItem message={message} onClose={removeToast} />
            </div>
          ))}
        </div>
      )}
    </ToastContext.Provider>
  );
};

// Internal Toast component to avoid circular imports
const ToastItem: React.FC<{ message: ToastMessage; onClose: (id: string) => void }> = ({ message, onClose }) => {
  React.useEffect(() => {
    const timer = setTimeout(() => {
      onClose(message.id);
    }, message.duration || 5000);

    return () => clearTimeout(timer);
  }, [message, onClose]);

  const getBackgroundColor = () => {
    switch (message.type) {
      case 'success':
        return 'bg-green-600';
      case 'error':
        return 'bg-red-600';
      case 'warning':
        return 'bg-yellow-600';
      case 'info':
        return 'bg-blue-600';
      default:
        return 'bg-gray-600';
    }
  };

  const getIcon = () => {
    switch (message.type) {
      case 'success':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case 'error':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
      case 'warning':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        );
      case 'info':
        return (
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
    }
  };

  return (
    <div 
      className={`${getBackgroundColor()} text-white px-4 py-3 rounded-lg shadow-lg flex items-center space-x-3 min-w-[300px] max-w-md animate-slide-in`}
    >
      <div className="flex-shrink-0">
        {getIcon()}
      </div>
      <div className="flex-1">
        <p className="text-sm font-medium">{message.message}</p>
      </div>
      <button
        onClick={() => onClose(message.id)}
        className="flex-shrink-0 ml-4 hover:opacity-75 transition-opacity"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
      </button>
    </div>
  );
};
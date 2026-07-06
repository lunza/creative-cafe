import React, { Suspense } from 'react';
import { CloseOutlined } from '@ant-design/icons';
import './FullscreenDialog.css';

interface FullscreenDialogProps {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}

const FullscreenDialog: React.FC<FullscreenDialogProps> = ({ visible, title, onClose, children }) => {
  if (!visible) return null;

  return (
    <div className="fullscreen-dialog">
      <div className="fullscreen-dialog-inner">
        <div className="fullscreen-dialog-header">
          <h3 className="fullscreen-dialog-title">{title}</h3>
          <button
            className="fullscreen-dialog-close-btn"
            onClick={onClose}
            onMouseEnter={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = '#ff7875';
              btn.style.transform = 'rotate(90deg) scale(1.1)';
            }}
            onMouseLeave={(e) => {
              const btn = e.currentTarget as HTMLButtonElement;
              btn.style.background = '#ff4d4f';
              btn.style.transform = 'rotate(0deg) scale(1)';
            }}
          >
            <CloseOutlined style={{ fontSize: 16, color: '#fff' }} />
          </button>
        </div>
        <div className="fullscreen-dialog-body">
          <Suspense
            fallback={
              <div className="fullscreen-dialog-fallback">
                加载{title}中...
              </div>
            }
          >
            {children}
          </Suspense>
        </div>
      </div>
    </div>
  );
};

export default FullscreenDialog;

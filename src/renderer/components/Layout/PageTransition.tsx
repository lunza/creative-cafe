import React, { useState, useEffect, useRef } from 'react';
import { useUIStore } from '../../stores/uiStore';

interface PageTransitionProps {
  children: React.ReactNode;
  activeKey: string;
}

const PageTransition: React.FC<PageTransitionProps> = ({ children, activeKey }) => {
  const { animationEnabled } = useUIStore();
  const [displayChildren, setDisplayChildren] = useState(children);
  const [displayKey, setDisplayKey] = useState(activeKey);
  const [animClass, setAnimClass] = useState(animationEnabled ? 'page-enter' : '');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    if (activeKey !== displayKey) {
      if (animationEnabled) {
        setAnimClass('page-exit');
        
        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }
        
        timerRef.current = setTimeout(() => {
          setDisplayKey(activeKey);
          setDisplayChildren(children);
          setAnimClass('page-enter');
        }, 200);
        
        return () => {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
          }
        };
      } else {
        setDisplayKey(activeKey);
        setDisplayChildren(children);
        setAnimClass('');
      }
    }
  }, [activeKey, displayKey, children, animationEnabled]);

  return (
    <div key={displayKey} className={`page-transition-wrapper ${animClass}`}>
      {displayChildren}
    </div>
  );
};

export default PageTransition;

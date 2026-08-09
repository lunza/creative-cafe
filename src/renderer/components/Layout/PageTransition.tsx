import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useUIStore } from '../../stores/uiStore';

interface PageTransitionProps {
  children: React.ReactNode;
  activeKey: string;
}

const EXIT_DURATION = 300;
const ENTER_DURATION = 450;

const PageTransition: React.FC<PageTransitionProps> = ({ children, activeKey }) => {
  const animationEnabled = useUIStore(s => s.animationEnabled);
  const [displayChildren, setDisplayChildren] = useState(children);
  const [displayKey, setDisplayKey] = useState(activeKey);
  const [animClass, setAnimClass] = useState('');
  const [isFirstRender, setIsFirstRender] = useState(true);

  const pendingChildrenRef = useRef(children);
  const pendingKeyRef = useRef(activeKey);
  const isTransitioningRef = useRef(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    pendingChildrenRef.current = children;
    pendingKeyRef.current = activeKey;
  });

  useEffect(() => {
    if (isFirstRender) {
      setIsFirstRender(false);
      return;
    }

    if (activeKey !== displayKey && !isTransitioningRef.current) {
      if (animationEnabled) {
        isTransitioningRef.current = true;
        setAnimClass('page-exit');

        if (timerRef.current) {
          clearTimeout(timerRef.current);
        }

        timerRef.current = setTimeout(() => {
          setDisplayKey(pendingKeyRef.current);
          setDisplayChildren(pendingChildrenRef.current);
          setAnimClass('page-enter');
        }, EXIT_DURATION);

        return () => {
          if (timerRef.current) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
          }
        };
      } else {
        setDisplayKey(pendingKeyRef.current);
        setDisplayChildren(pendingChildrenRef.current);
        setAnimClass('');
      }
    }
  }, [activeKey, displayKey, animationEnabled]);

  const handleAnimationEnd = useCallback((e: React.AnimationEvent<HTMLDivElement>) => {
    if (e.animationName === 'pageEnter') {
      setAnimClass('');
      isTransitioningRef.current = false;
    }
  }, []);

  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return (
    <div
      key={displayKey}
      className={`page-transition-wrapper ${animClass}`}
      onAnimationEnd={handleAnimationEnd}
    >
      {displayChildren}
    </div>
  );
};

export default PageTransition;

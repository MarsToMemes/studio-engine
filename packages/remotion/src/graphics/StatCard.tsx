import React from 'react';
import { counterProgress, counterText } from './Counter';
import { FONT, str, type GraphicProps } from './common';

/** Card with an accent bar, the counting number and its label. */
export const StatCard: React.FC<GraphicProps> = ({ layer, frame, fps, height }) => {
  const { data } = layer;
  const accent = str(data.accent, '#FFC72C');
  return (
    <div style={{ width: '100%', height: '100%', boxSizing: 'border-box', display: 'flex', alignItems: 'stretch', background: 'rgba(24,24,24,0.92)', borderRadius: 18, overflow: 'hidden', boxShadow: '0 30px 80px rgba(0,0,0,0.5)' }}>
      <div style={{ width: 14, background: accent }} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '0 6%', fontFamily: FONT }}>
        <div style={{ fontSize: height * 0.42, fontWeight: 900, letterSpacing: -4, color: accent, lineHeight: 1 }}>{counterText(data, counterProgress(data, frame, fps))}</div>
        {data.label ? <div style={{ fontSize: height * 0.1, fontWeight: 700, color: '#FFFFFF', marginTop: height * 0.04, textTransform: 'uppercase' }}>{str(data.label)}</div> : null}
      </div>
    </div>
  );
};

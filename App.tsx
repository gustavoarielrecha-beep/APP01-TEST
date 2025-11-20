import React, { useState, useCallback } from 'react';
import { ColorButton } from './components/ColorButton';
import { BUTTON_COLORS } from './utils/constants';

const App: React.FC = () => {
  // Initialize state with the first color in the list
  const [currentColorIndex, setCurrentColorIndex] = useState<number>(7); // Start with a nice blue

  const handleButtonClick = useCallback(() => {
    setCurrentColorIndex((prevIndex) => {
      let nextIndex;
      // Ensure we pick a different color than the current one
      do {
        nextIndex = Math.floor(Math.random() * BUTTON_COLORS.length);
      } while (nextIndex === prevIndex);
      
      return nextIndex;
    });
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-slate-50 text-slate-800">
      <div className="text-center space-y-8">
        <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl mb-8">
          Interactividad React
        </h1>
        
        <div className="p-12 bg-white rounded-3xl shadow-2xl border border-slate-100 flex items-center justify-center">
          <ColorButton 
            colorClass={BUTTON_COLORS[currentColorIndex]} 
            onClick={handleButtonClick} 
          />
        </div>
        
        <p className="text-slate-500 mt-8 text-lg">
          Haz click en el botón para cambiar su color.
        </p>
      </div>
    </div>
  );
};

export default App;
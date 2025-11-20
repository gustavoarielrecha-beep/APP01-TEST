import React from 'react';

interface ColorButtonProps {
  colorClass: string;
  onClick: () => void;
}

export const ColorButton: React.FC<ColorButtonProps> = ({ colorClass, onClick }) => {
  return (
    <button
      onClick={onClick}
      className={`
        ${colorClass}
        text-white 
        font-bold 
        text-2xl 
        py-6 
        px-10 
        rounded-2xl 
        shadow-xl 
        transform 
        transition-all 
        duration-300 
        ease-in-out
        hover:scale-110 
        active:scale-95 
        focus:outline-none 
        focus:ring-4 
        cursor-pointer
        select-none
      `}
    >
      Hola Mundo
    </button>
  );
};
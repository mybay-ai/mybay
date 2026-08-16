import React from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

interface BrandLogoProps {
  className?: string;
  iconOnly?: boolean;
  textColor?: string;
  size?: "sm" | "md" | "lg";
  useSvg?: boolean; // Option to force SVG version for the horizontal logo
  invertOnDark?: boolean;
}

export function BrandLogo({ 
  className, 
  iconOnly = false, 
  textColor = "text-white", 
  size = "md",
  useSvg = false,
  invertOnDark = false
}: BrandLogoProps) {
  const { i18n } = useTranslation();
  const language = (i18n.resolvedLanguage || i18n.language || "zh-CN").toLowerCase();
  const isEnglish = language.startsWith("en");

  // Dimensions for the horizontal logo (main brand logo)
  const horizontalHeights = {
    sm: "h-8 sm:h-9",
    md: "h-11 sm:h-12",
    lg: "h-18 sm:h-20",
  };

  // Dimensions for the icon-only version (square favicon / small-size mark)
  const iconDimensions = {
    sm: "w-8 h-8",
    md: "w-11 h-11",
    lg: "w-18 h-18",
  };

  const isDarkBg = textColor.includes("white") || textColor.includes("slate-300");

  if (iconOnly) {
    const currentDim = iconDimensions[size];
    return (
      <div className={cn("flex items-center justify-center select-none group transition-all shrink-0", className)}>
        <img
          src="/favicon.svg"
          alt="MyBay Icon"
          referrerPolicy="no-referrer"
          className={cn(
            "object-contain transition-transform duration-300 ease-out group-hover:scale-[1.05]",
            currentDim
          )}
        />
      </div>
    );
  }

  const currentHeight = horizontalHeights[size];
  const localizedLogoSrc = isEnglish
    ? "/assets/logos/mybay_logo-en.png"
    : "/assets/logos/mybay_logo-cn.png";
  const logoSrc = useSvg ? "/assets/logos/mybay_logo.svg" : localizedLogoSrc;

  return (
    <div className={cn("flex items-center select-none group transition-all shrink-0", className)}>
      <img
        src={logoSrc}
        alt="MyBay Logo"
        referrerPolicy="no-referrer"
        className={cn(
          "w-auto object-contain transition-transform duration-300 ease-out group-hover:scale-[1.02]",
          currentHeight,
          isDarkBg && "brightness-0 invert",
          invertOnDark && "dark:brightness-0 dark:invert"
        )}
      />
    </div>
  );
}



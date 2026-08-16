import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

declare global {
  interface Window {
    turnstile: any;
  }
}

export function Turnstile({ siteKey, onSuccess, onError }: { siteKey: string, onSuccess: (token: string) => void, onError?: (err: string) => void }) {
  const { t } = useTranslation("auth");
  const containerRef = useRef<HTMLDivElement>(null);
  const rendered = useRef(false);

  useEffect(() => {
    const scriptId = "cf-turnstile-script";
    let script = document.getElementById(scriptId) as HTMLScriptElement;

    const render = () => {
      if (containerRef.current && window.turnstile && !rendered.current) {
        try {
          window.turnstile.render(containerRef.current, {
            sitekey: siteKey,
            callback: (token: string) => {
              onSuccess(token);
            },
            'error-callback': (code: string) => {
              console.error("Turnstile error:", code);
              if (onError) onError(t("captchaWidgetLoadFailed", { code }));
            }
          });
          rendered.current = true;
        } catch (e: any) {
          console.error("Turnstile render exception:", e);
          if (onError) onError(t("captchaWidgetRenderFailed"));
        }
      }
    };

    if (!script) {
      script = document.createElement("script");
      script.id = scriptId;
      script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
      script.async = true;
      script.defer = true;
      script.onerror = () => {
        console.error("Turnstile script load error");
        if (onError) onError(t("captchaScriptLoadFailed"));
      };
      document.head.appendChild(script);
      script.onload = () => {
        setTimeout(render, 100);
      };
    } else if (window.turnstile) {
      render();
    } else {
      // Script exists but turnstile not loaded yet
      script.addEventListener('load', () => setTimeout(render, 100));
    }

    return () => {
      // In a SPA, we might want to reset but usually it's fine
    };
  }, [siteKey, onSuccess, onError, t]);

  return <div ref={containerRef} className="my-4 flex justify-center min-h-[65px]" />;
}

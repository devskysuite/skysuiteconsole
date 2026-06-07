import { useEffect, useState } from "react";
import { doc, getDoc } from "firebase/firestore";
import { useParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { db } from "../firebase";

export default function PrintLabelPage() {
  const { toolId } = useParams<{ toolId: string }>();
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!toolId) { setLoading(false); return; }
    getDoc(doc(db, "tools", toolId))
      .then((snap) => {
        if (snap.exists()) setName(snap.data().name ?? "");
      })
      .catch(() => { /* name is optional — page still renders without it */ })
      .finally(() => setLoading(false));
  }, [toolId]);

  // Auto-trigger print dialog once content is ready
  useEffect(() => {
    if (loading) return;
    const timer = setTimeout(() => window.print(), 600);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading) return null;

  return (
    <>
      <style>{`
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #fff; }

        .page {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          min-height: 100vh;
          font-family: Arial, sans-serif;
          text-align: center;
          gap: 14px;
          padding: 24px;
        }

        .hint {
          position: fixed;
          top: 0; left: 0; right: 0;
          background: #1e7d3a;
          color: #fff;
          text-align: center;
          padding: 12px;
          font-family: Arial, sans-serif;
          font-size: 15px;
          font-weight: 700;
          z-index: 999;
        }

        .logo { height: 44px; object-fit: contain; }
        .tool-id { font-weight: 900; font-size: 26px; color: #1e7d3a; letter-spacing: 1px; }
        .tool-name { font-size: 17px; color: #555; }

        @media print {
          @page { margin: 0; }
          .hint { display: none !important; }
          .page {
            min-height: unset;
            justify-content: center;
            padding: 40px 24px;
          }
        }
      `}</style>

      {/* Banner — hidden when printing */}
      <div className="hint">
        Printing… &nbsp;|&nbsp; or press{" "}
        <kbd style={{ background: "rgba(255,255,255,0.25)", padding: "2px 8px", borderRadius: 4 }}>Ctrl + P</kbd>
      </div>

      <div className="page" style={{ marginTop: 48 }}>
        <img className="logo" src="/rbt_logo.png" alt="RBT" />
        <QRCodeSVG value={toolId ?? ""} size={240} level="M" />
        <p className="tool-id">{toolId}</p>
        {name && <p className="tool-name">{name}</p>}
      </div>
    </>
  );
}

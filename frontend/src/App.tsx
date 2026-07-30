import { useRef, useState } from "react";

function App() {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [image, setImage] = useState<string | null>(null);

  const handleScanClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];

    if (!file) return;

    const imageUrl = URL.createObjectURL(file);
    setImage(imageUrl);
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        minHeight: "100vh",
        background: "#111827",
        color: "white",
        fontFamily: "Arial",
        paddingTop: "60px",
      }}
    >
      <h1>CardPilot</h1>

      <h2>Ready to Scan Your First Card</h2>

      <button
        onClick={handleScanClick}
        style={{
          padding: "15px 30px",
          fontSize: "20px",
          cursor: "pointer",
          marginTop: "25px",
        }}
      >
        📷 Scan Card
      </button>

      <input
        type="file"
        accept="image/*"
        capture="environment"
        ref={fileInputRef}
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {image && (
        <>
          <h3 style={{ marginTop: "40px" }}>Selected Card</h3>

          <img
            src={image}
            alt="Card"
            style={{
              maxWidth: "350px",
              borderRadius: "12px",
              marginTop: "15px",
            }}
          />
        </>
      )}
    </div>
  );
}

export default App;
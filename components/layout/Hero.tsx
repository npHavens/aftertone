export function Hero() {
  return (
    <section className="hero">
      <div className="hero-copy">
        <p className="small-tag">From your shelf. To your speakers.</p>
        <h1>
          Your music,
          <br />
          rediscovered.
        </h1>
        <p className="hero-description">
          Old favorites deserve another spin. Turn your album photos into a playlist you can take
          anywhere.
        </p>
      </div>
      <div className="mixtape" aria-hidden="true">
        <div className="tape-top">
          <span>AFTERTONE</span>
          <span>90</span>
        </div>
        <div className="tape-label">
          THE GOOD
          <br />
          STUFF.
        </div>
        <div className="tape-window">
          <span className="reel" />
          <span className="tape-line" />
          <span className="reel" />
        </div>
        <div className="tape-bottom">
          SIDE A <span>PLAY IT AGAIN ↗</span>
        </div>
      </div>
    </section>
  );
}

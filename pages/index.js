import dynamic from 'next/dynamic';
import Head from 'next/head';

// No SSR — Chart.js and Grid.js need the browser DOM
const Dashboard = dynamic(() => import('../components/Dashboard'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Engineering Delivery Dashboard</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex" />
      </Head>
      <Dashboard />
    </>
  );
}

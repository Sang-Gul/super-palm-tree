import React, { useState } from 'react';

// 유틸리티 함수: base64로 인코딩된 데이터를 ArrayBuffer로 디코딩
const base64ToArrayBuffer = (base64) => {
    const binaryString = atob(base64);
    const len = binaryString.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    return bytes.buffer;
};

// 유틸리티 함수: PCM 데이터를 WAV 형식 Blob으로 변환
const pcmToWav = (pcm, sampleRate) => {
    const data = new DataView(new ArrayBuffer(44 + pcm.length * 2));
    let offset = 0;

    // WAV 헤더
    function writeString(s) {
        for (let i = 0; i < s.length; i++) {
            data.setUint8(offset + i, s.charCodeAt(i));
        }
        offset += s.length;
    }
    function writeUint32(i) {
        data.setUint32(offset, i, true);
        offset += 4;
    }
    function writeUint16(i) {
        data.setUint16(offset, i, true);
        offset += 2;
    }

    writeString('RIFF'); // ChunkID
    writeUint32(36 + pcm.length * 2); // ChunkSize
    writeString('WAVE'); // Format
    writeString('fmt '); // Subchunk1ID
    writeUint32(16); // Subchunk1Size
    writeUint16(1); // AudioFormat (1 = PCM)
    writeUint16(1); // NumChannels
    writeUint32(sampleRate); // SampleRate
    writeUint32(sampleRate * 2); // ByteRate
    writeUint16(2); // BlockAlign
    writeUint16(16); // BitsPerSample
    writeString('data'); // Subchunk2ID
    writeUint32(pcm.length * 2); // Subchunk2Size

    // PCM 데이터
    for (let i = 0; i < pcm.length; i++) {
        data.setInt16(offset, pcm[i], true);
        offset += 2;
    }

    return new Blob([data], { type: 'audio/wav' });
};

const App = () => {
    // 사용자 입력 상태
    const [userThought, setUserThought] = useState('');
    // 명언 및 저자 정보 상태
    const [quoteData, setQuoteData] = useState(null);
    // 로딩 상태
    const [isLoading, setIsLoading] = useState(false);
    // 에러 상태
    const [error, setError] = useState(null);
    // 오디오 재생 상태
    const [isPlaying, setIsPlaying] = useState(false);

    // API 호출 및 명언 찾기 함수
    const fetchQuote = async () => {
        setIsLoading(true);
        setError(null);
        setQuoteData(null);

        // 사용자의 관점을 기반으로 명언 또는 책 구절을 찾아달라는 프롬프트 생성 (한국어)
        const prompt = `
            사용자의 생각과 유사하거나 지지하는 유명인의 명언 또는 유명 저서의 구절을 찾아주세요.
            응답은 다음 JSON 형식으로 제공하고, 모든 필드의 값은 한국어로 작성해 주세요.

            - 'sourceType': 명언의 출처가 인물인 경우 "person", 책인 경우 "book"으로 지정해 주세요.
            - 'quote': 명언 또는 구절을 작성해 주세요.
            - 'author': 저자의 이름을 작성해 주세요.
            - 'sourceDescription': 명언이나 문장이 나온 구체적인 출처를 자세하게 작성해 주세요. 예를 들어, '1963년 워싱턴 행진에서의 연설'이나 '저서 [책명]에 있는 문장'과 같이 작성해 주세요.
            - 만약 'sourceType'이 "person"이라면, 'nationality' (국적), 'field' (예: '철학자', '과학자'), 'lifespan' (생존 기간, 예: '1879-1955') 필드를 추가로 작성해 주세요.
            - 만약 'sourceType'이 "book"이라면, 'bookTitle' (책 제목) 필드를 추가로 작성해 주세요.

            사용자의 생각: "${userThought}"
        `;

        // LLM에 요청할 페이로드 구성
        const payload = {
            contents: [{ role: "user", parts: [{ text: prompt }] }],
            generationConfig: {
                responseMimeType: "application/json",
                responseSchema: {
                    type: "OBJECT",
                    properties: {
                        "sourceType": { "type": "STRING" },
                        "quote": { "type": "STRING" },
                        "author": { "type": "STRING" },
                        "sourceDescription": { "type": "STRING", "nullable": true },
                        "nationality": { "type": "STRING", "nullable": true },
                        "field": { "type": "STRING", "nullable": true },
                        "lifespan": { "type": "STRING", "nullable": true },
                        "bookTitle": { "type": "STRING", "nullable": true }
                    },
                    required: ["sourceType", "quote", "author", "sourceDescription"]
                }
            }
        };

        const apiKey = "";
        const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-05-20:generateContent?key=${apiKey}`;

        let retries = 0;
        const maxRetries = 5;
        const baseDelay = 1000; // 1 second

        while (retries < maxRetries) {
            try {
                const response = await fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                const jsonText = result?.candidates?.[0]?.content?.parts?.[0]?.text;

                if (!jsonText) {
                    throw new Error("API 응답이 올바른 JSON 형식이 아닙니다.");
                }

                const parsedJson = JSON.parse(jsonText);
                setQuoteData(parsedJson);

                // 성공적으로 데이터를 받으면 루프를 종료
                break;
            } catch (err) {
                console.error("API 호출 중 오류 발생:", err);
                retries++;
                if (retries < maxRetries) {
                    const delay = baseDelay * Math.pow(2, retries);
                    console.log(`재시도 (${retries}/${maxRetries}), ${delay}ms 후...`);
                    await new Promise(resolve => setTimeout(resolve, delay));
                } else {
                    setError('명언을 찾는 데 실패했습니다. 다시 시도해 주세요.');
                }
            } finally {
                setIsLoading(false);
            }
        }
    };

    // TTS API 호출 및 오디오 재생 함수
    const playQuoteAudio = async (text) => {
        setIsPlaying(true);
        try {
            const payload = {
                contents: [{ parts: [{ text: `차분하고 사려 깊은 톤으로 말해주세요: ${text}` }] }],
                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: {
                            prebuiltVoiceConfig: { voiceName: "Rasalgethi" }
                        }
                    }
                },
                model: "gemini-2.5-flash-preview-tts"
            };

            const apiKey = "";
            const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

            const response = await fetch(apiUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const result = await response.json();
            const audioPart = result?.candidates?.[0]?.content?.parts?.[0];
            const audioData = audioPart?.inlineData?.data;
            const mimeType = audioPart?.inlineData?.mimeType;

            if (audioData && mimeType && mimeType.startsWith("audio/")) {
                const sampleRateMatch = mimeType.match(/rate=(\d+)/);
                const sampleRate = sampleRateMatch ? parseInt(sampleRateMatch[1], 10) : 16000;
                const pcmData = base64ToArrayBuffer(audioData);
                const pcm16 = new Int16Array(pcmData);
                const wavBlob = pcmToWav(pcm16, sampleRate);
                const audioUrl = URL.createObjectURL(wavBlob);

                const audio = new Audio(audioUrl);
                audio.play();
                audio.onended = () => setIsPlaying(false);
            } else {
                console.error("오디오 데이터를 찾을 수 없습니다.");
                setIsPlaying(false);
            }
        } catch (err) {
            console.error("오디오 재생 중 오류 발생:", err);
            setIsPlaying(false);
        }
    };

    // 사용자 입력 핸들러
    const handleInputChange = (event) => {
        setUserThought(event.target.value);
    };

    // 버튼 클릭 핸들러
    const handleButtonClick = () => {
        if (userThought.trim() === '') {
            setError('먼저 당신의 생각을 입력해주세요.');
            return;
        }
        fetchQuote();
    };

    // 결과 표시
    const renderQuoteResult = () => {
        if (!quoteData) return null;

        const { quote, author, sourceType, nationality, field, lifespan, bookTitle, sourceDescription } = quoteData;

        return (
            <div className="mt-8 p-6 bg-indigo-50 rounded-2xl shadow-inner text-left">
                <p className="text-gray-600 italic mb-4 text-lg leading-relaxed">
                    "{quote}"
                </p>
                <div className="border-t border-indigo-200 pt-4">
                    <p className="text-sm text-gray-500">
                        <strong>출처:</strong> {sourceDescription}
                    </p>
                    {sourceType === "person" ? (
                        <>
                            <p className="text-sm text-gray-500">
                                <strong>인물:</strong> {author}
                            </p>
                            <p className="text-sm text-gray-500">
                                생존 기간: {lifespan}
                            </p>
                            <p className="text-sm text-gray-500">
                                국적: {nationality}
                            </p>
                            <p className="text-sm text-gray-500">
                                관련 분야: {field}
                            </p>
                        </>
                    ) : (
                        <>
                            <p className="text-sm text-gray-500">
                                <strong>저자:</strong> {author}
                            </p>
                            <p className="text-sm text-gray-500">
                                <strong>책명:</strong> {bookTitle}
                            </p>
                        </>
                    )}
                </div>
                <button
                    onClick={() => playQuoteAudio(quote)}
                    disabled={isPlaying}
                    className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:bg-indigo-400"
                >
                    {isPlaying ? (
                        <>
                            <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            <span>재생 중...</span>
                        </>
                    ) : (
                        <>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 mr-2" viewBox="0 0 20 20" fill="currentColor">
                                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z" clipRule="evenodd" />
                            </svg>
                            <span>명언 듣기</span>
                        </>
                    )}
                </button>
            </div>
        );
    };

    return (
        <div className="bg-gray-100 min-h-screen p-4 flex items-center justify-center font-sans">
            <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-2xl text-center">
                <h1 className="text-3xl font-bold mb-6 text-gray-800">
                    당신의 생각과 비슷한 명언 찾기
                </h1>
                <p className="mb-6 text-gray-600">
                    자신의 관점이나 생각을 아래에 입력하면, 그와 유사한 유명인의 명언이나 책의 구절을 찾아드립니다.
                </p>
                <textarea
                    className="w-full p-4 mb-4 border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500 transition-colors duration-200 resize-none"
                    rows="6"
                    value={userThought}
                    onChange={handleInputChange}
                    placeholder="예: '실패는 끝이 아니라 성공으로 가는 과정이다.'"
                />
                <button
                    onClick={handleButtonClick}
                    disabled={isLoading}
                    className="w-full bg-indigo-600 text-white font-semibold py-3 px-6 rounded-xl shadow-lg hover:bg-indigo-700 transition-colors duration-200 disabled:bg-indigo-400"
                >
                    {isLoading ? '명언 찾는 중...' : '명언 찾기'}
                </button>

                {error && (
                    <div className="mt-6 p-4 bg-red-100 text-red-700 rounded-xl">
                        <p>{error}</p>
                    </div>
                )}

                {renderQuoteResult()}
            </div>
        </div>
    );
};

export default App;

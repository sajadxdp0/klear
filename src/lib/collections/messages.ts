/**
 * Outreach message drafts, one per language, per branch.
 * Kind by design: an offer, never a threat. Disclosure where a call
 * would be recorded. The manager reads these before approving.
 */

export type Branch = "PAYMENT_LINK" | "PARTIAL_LINK" | "DEFER" | "CALL";

export interface DraftInput {
  name: string;
  loanNo: string;
  amountRupees: string;
  linkUrl?: string;
  minimumRupees?: string;
}

export function draftMessage(branch: Branch, language: string, d: DraftInput): string {
  const hi: Record<Branch, string> = {
    PAYMENT_LINK: `नमस्ते ${d.name}, आपके ऋण ${d.loanNo} पर ₹${d.amountRupees} बाकी है। इस लिंक से UPI या कार्ड से अभी भुगतान कर सकते हैं: ${d.linkUrl}. कोई भी सवाल हो तो हमें बताइए, मदद के लिए यहीं हैं।`,
    PARTIAL_LINK: `नमस्ते ${d.name}, हम समझते हैं कि इस महीने भुगतान मुश्किल हो सकता है। अगर पूरा नहीं दे सकते तो कम से कम ₹${d.minimumRupees} से शुरुआत कर सकते हैं: ${d.linkUrl}. आपकी दिक्कत से हम खेलेंगे नहीं, साथ मिलकर हल निकालेंगे।`,
    DEFER: `नमस्ते ${d.name}, जैसा आपने बताया, सैलरी आने के बाद हम आपसे दोबारा बात करेंगे। तब तक कोई तंग नहीं करेगा। भुगतान का लिंक: ${d.linkUrl}.`,
    CALL: `नमस्ते ${d.name}, ${d.loanNo} के बारे में बात करनी है — कुल ₹${d.amountRupees} बाकी है। यह बातचीत रिकॉर्ड की जा रही है। भुगतान के लिए कभी भी यह लिंक खोल सकते हैं: ${d.linkUrl}.`,
  };
  const ta: Record<Branch, string> = {
    PAYMENT_LINK: `வணக்கம் ${d.name}, உங்கள் கடன் ${d.loanNo} க்கு ₹${d.amountRupees} நிலுவையில் உள்ளது. இந்த இணைப்பில் UPI அல்லது கார்டு மூலம் இப்போதே செலுத்தலாம்: ${d.linkUrl}. ஏதேனும் கேள்வி இருந்தால் சொல்லுங்கள்.`,
    PARTIAL_LINK: `வணக்கம் ${d.name}, இந்த மாதம் முழு தொகை கடினமாக இருந்தால், குறைந்தது ₹${d.minimumRupees} இலிருந்து தொடங்கலாம்: ${d.linkUrl}. உங்களுக்கு வசதியான முறையில் நாங்கள் உதவி செய்வோம்.`,
    DEFER: `வணக்கம் ${d.name}, சம்பளம் வந்தபின் மீண்டும் பேசலாம். அதுவரை யாரும் தொந்தரவு செய்யாது. பணம் செலுத்த: ${d.linkUrl}.`,
    CALL: `வணக்கம் ${d.name}, ${d.loanNo} பற்றி பேச வேண்டும் — ₹${d.amountRupees} நிலுவையில் உள்ளது. இந்த உரையாடல் பதிவு செய்யப்படுகிறது. பணம் செலுத்த: ${d.linkUrl}.`,
  };
  const kn: Record<Branch, string> = {
    PAYMENT_LINK: `ನಮಸ್ಕಾರ ${d.name}, ನಿಮ್ಮ ಸಾಲ ${d.loanNo} ಗೆ ₹${d.amountRupees} ಬಾಕಿ ಇದೆ. ಈ ಲಿಂಕ್ ಮೂಲಕ UPI ಅಥವಾ ಕಾರ್ಡ್ ನಿಂದ ಈಗಲೇ ಪಾವತಿಸಬಹುದು: ${d.linkUrl}.`,
    PARTIAL_LINK: `ನಮಸ್ಕಾರ ${d.name}, ಈ ತಿಂಗಳು ಪೂರ್ಣ ಹಣ ಕಷ್ಟವಾದರೆ, ಕನಿಷ್ಠ ₹${d.minimumRupees} ಇಂದ ಪ್ರಾರಂಭಿಸಿ: ${d.linkUrl}. ನಿಮಗೆ ಅನುಕೂಲವಾಗುವಂತೆ ಸಹಾಯ ಮಾಡುತ್ತೇವೆ.`,
    DEFER: `ನಮಸ್ಕಾರ ${d.name}, ಸಂಬಳ ಬಂದ ನಂತರ ಮತ್ತೆ ಮಾತನಾಡೋಣ. ಅದುವರೆಗೆ ಯಾರೂ ತೊಂದರೆ ಕೊಡುವುದಿಲ್ಲ. ಪಾವತಿ: ${d.linkUrl}.`,
    CALL: `ನಮಸ್ಕಾರ ${d.name}, ${d.loanNo} ಬಗ್ಗೆ ಮಾತನಾಡಬೇಕು — ₹${d.amountRupees} ಬಾಕಿ ಇದೆ. ಈ ಸಂಭಾಷಣೆ ದಾಖಲಾಗುತ್ತದೆ. ಪಾವತಿ: ${d.linkUrl}.`,
  };
  const en: Record<Branch, string> = {
    PAYMENT_LINK: `Hello ${d.name}, your loan ${d.loanNo} has ₹${d.amountRupees} outstanding. You can pay right now via UPI or card using this link: ${d.linkUrl}. Questions? We're here to help.`,
    PARTIAL_LINK: `Hello ${d.name}, if paying in full is hard this month, you can start with as little as ₹${d.minimumRupees}: ${d.linkUrl}. We'll work with what's possible for you.`,
    DEFER: `Hello ${d.name}, as you mentioned, we'll reach out again after your salary arrives. Nobody will pester you until then. Payment link for when you're ready: ${d.linkUrl}.`,
    CALL: `Hello ${d.name}, calling about ${d.loanNo} — ₹${d.amountRupees} outstanding. This call is being recorded. Payment link: ${d.linkUrl}.`,
  };

  switch (language) {
    case "ta-IN": return ta[branch];
    case "kn-IN": return kn[branch];
    case "hi-IN": return hi[branch];
    default: return en[branch];
  }
}

const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = "https://kulzzy.github.io";

const SERVICES = {
  "Celebration Announcement Only": 3000,
  "Celebration Phone Call Interview": 7000
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    },
    body: JSON.stringify(body)
  };
}

exports.handler = async function (event) {
  if (event.httpMethod === "OPTIONS") {
    return response(200, { success: true });
  }

  if (event.httpMethod !== "POST") {
    return response(405, {
      success: false,
      message: "Method not allowed"
    });
  }

  try {
    if (!process.env.FLW_SECRET_KEY) {
      return response(500, {
        success: false,
        message: "Flutterwave secret key is not configured."
      });
    }

    let data;

    try {
      data = JSON.parse(event.body || "{}");
    } catch (error) {
      return response(400, {
        success: false,
        message: "Invalid request data."
      });
    }

    const {
      service,
      relationship,
      category,
      celebrantName,
      celebrantPhone,
      senderName,
      whatsappNumber,
      writeup,
      celebrationDate
    } = data;

    if (!service || !SERVICES[service]) {
      return response(400, {
        success: false,
        message: "Please select a valid service."
      });
    }

    if (!relationship) {
      return response(400, {
        success: false,
        message: "Please select your relationship."
      });
    }

    if (!category) {
      return response(400, {
        success: false,
        message: "Please select a celebration category."
      });
    }

    if (!celebrantName || !String(celebrantName).trim()) {
      return response(400, {
        success: false,
        message: "Please enter the celebrant name."
      });
    }

    if (
      service === "Celebration Phone Call Interview" &&
      (!celebrantPhone || !String(celebrantPhone).trim())
    ) {
      return response(400, {
        success: false,
        message: "Please enter the celebrant phone number."
      });
    }

    if (!senderName || !String(senderName).trim()) {
      return response(400, {
        success: false,
        message: "Please enter your name."
      });
    }

    if (!whatsappNumber || !String(whatsappNumber).trim()) {
      return response(400, {
        success: false,
        message: "Please enter your WhatsApp number."
      });
    }

    if (!writeup || !String(writeup).trim()) {
      return response(400, {
        success: false,
        message: "Please enter your celebration message."
      });
    }

    if (!celebrationDate) {
      return response(400, {
        success: false,
        message: "Please select the celebration date."
      });
    }

    const amount = SERVICES[service];

    const txRef =
      "KULZZY-" +
      Date.now() +
      "-" +
      Math.floor(100000 + Math.random() * 900000);

    const store = getStore({
      name: "kulzzy-celebration-requests",
      consistency: "strong"
    });

    const pendingRequest = {
      requestStatus: "PENDING_PAYMENT",

      txRef,

      service,
      amountRequired: amount,
      currency: "NGN",

      relationship,
      category,

      celebrantName: String(celebrantName).trim(),
      celebrantPhone: celebrantPhone
        ? String(celebrantPhone).trim()
        : "",

      senderName: String(senderName).trim(),
      whatsappNumber: String(whatsappNumber).trim(),

      writeup: String(writeup).trim(),
      celebrationDate,

      createdAt: new Date().toISOString()
    };

    await store.setJSON(`pending/${txRef}`, pendingRequest);

    return response(200, {
      success: true,
      txRef,
      amount,
      currency: "NGN",
      publicKey: process.env.FLW_PUBLIC_KEY || ""
    });
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error);

    return response(500, {
      success: false,
      message: "Unable to create payment."
    });
  }
};

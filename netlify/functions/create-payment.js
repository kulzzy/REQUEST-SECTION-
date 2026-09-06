const { getStore } = require("@netlify/blobs");

const ALLOWED_ORIGIN = "https://kulzzy.github.io/app/";

const headers = {
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

const PRICES = {
  "Celebration Announcement Only": 3000,
  "Celebration Phone Call Interview": 7000
};

exports.handler = async (event) => {

  if (event.httpMethod === "OPTIONS") {
    return {
      statusCode: 204,
      headers,
      body: ""
    };
  }

  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      headers,
      body: JSON.stringify({
        success: false,
        message: "Method not allowed"
      })
    };
  }

  try {

    if (!process.env.FLW_SECRET_KEY) {
      return {
        statusCode: 500,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Flutterwave secret key is not configured"
        })
      };
    }


    let data;

    try {
      data = JSON.parse(event.body || "{}");
    } catch (error) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Invalid request data"
        })
      };
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


    if (!service || !PRICES[service]) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Invalid celebration service"
        })
      };
    }


    if (!senderName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Your name is required"
        })
      };
    }


    if (!whatsappNumber) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "WhatsApp number is required"
        })
      };
    }


    if (!celebrantName) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Celebrant name is required"
        })
      };
    }


    const amount =
      PRICES[service];


    const txRef =
      "KULZZY-" +
      Date.now() +
      "-" +
      Math.floor(
        100000 +
        Math.random() * 900000
      );


    const store =
      getStore(
        "kulzzy-celebration-requests"
      );


    const pendingRequest = {

      requestStatus:
        "PENDING_PAYMENT",

      txRef,

      service,

      amountRequired:
        amount,

      currency:
        "NGN",

      relationship:
        relationship || "",

      category:
        category || "",

      celebrantName:
        celebrantName || "",

      celebrantPhone:
        celebrantPhone || "",

      senderName:
        senderName || "",

      whatsappNumber:
        whatsappNumber || "",

      writeup:
        writeup || "",

      celebrationDate:
        celebrationDate || "",

      createdAt:
        new Date().toISOString()

    };


    await store.setJSON(
      `pending/${txRef}`,
      pendingRequest
    );


    return {

      statusCode: 200,

      headers,

      body: JSON.stringify({

        success:
          true,

        publicKey:
          process.env.FLW_PUBLIC_KEY,

        tx_ref:
          txRef,

        amount:
          amount,

        currency:
          "NGN"

      })

    };

  }

  catch (error) {

    console.error(
      "CREATE PAYMENT ERROR:",
      error
    );

    return {

      statusCode: 500,

      headers,

      body: JSON.stringify({

        success:
          false,

        message:
          "Unable to create payment"

      })

    };

  }

};

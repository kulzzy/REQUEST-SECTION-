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
  // Allow browser CORS preflight request
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
      transaction_id,
      tx_ref,
      service
    } = data;

    if (!transaction_id) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Transaction ID is required"
        })
      };
    }

    if (!tx_ref) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Transaction reference is required"
        })
      };
    }

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

    const expectedAmount = PRICES[service];

    const store = getStore("kulzzy-celebration-requests");

    const pendingRequest = await store.getJSON(`pending/${tx_ref}`);

    if (!pendingRequest) {
      return {
        statusCode: 404,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Pending request not found"
        })
      };
    }

    if (pendingRequest.txRef !== tx_ref) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Transaction reference mismatch"
        })
      };
    }

    if (pendingRequest.service !== service) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Service mismatch"
        })
      };
    }

    const flutterwaveResponse = await fetch(
      `https://api.flutterwave.com/v3/transactions/${encodeURIComponent(
        transaction_id
      )}/verify`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${process.env.FLW_SECRET_KEY}`,
          "Content-Type": "application/json"
        }
      }
    );

    let flutterwaveData;

    try {
      flutterwaveData = await flutterwaveResponse.json();
    } catch (error) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Invalid response from Flutterwave"
        })
      };
    }

    if (!flutterwaveResponse.ok || !flutterwaveData) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Unable to verify payment with Flutterwave"
        })
      };
    }

    const transaction = flutterwaveData.data;

    if (!transaction) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Flutterwave transaction not found"
        })
      };
    }

    if (transaction.status !== "successful") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Payment was not successful"
        })
      };
    }

    if (transaction.currency !== "NGN") {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Invalid payment currency"
        })
      };
    }

    if (Number(transaction.amount) < expectedAmount) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Payment amount is insufficient"
        })
      };
    }

    if (transaction.tx_ref !== tx_ref) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({
          success: false,
          message: "Flutterwave transaction reference mismatch"
        })
      };
    }

    const finalRequest = {
      requestStatus: "PAID",

      service: pendingRequest.service,
      relationship: pendingRequest.relationship,
      category: pendingRequest.category,

      celebrantName: pendingRequest.celebrantName,
      celebrantPhone: pendingRequest.celebrantPhone,

      senderName: pendingRequest.senderName,
      whatsappNumber: pendingRequest.whatsappNumber,

      email: pendingRequest.email,

      writeup: pendingRequest.writeup,
      celebrationDate: pendingRequest.celebrationDate,

      paymentStatus: "PAID",
      paymentProcessor: "Flutterwave",

      transactionId: String(transaction.id),
      txRef: pendingRequest.txRef,

      amountPaid: Number(transaction.amount),
      currency: transaction.currency,

      paymentStatusFromFlutterwave: transaction.status,

      paidAt: transaction.created_at || new Date().toISOString(),
      verifiedAt: new Date().toISOString(),

      createdAt: pendingRequest.createdAt
    };

    await store.setJSON(`requests/${tx_ref}`, finalRequest);

    try {
      await store.delete(`pending/${tx_ref}`);
    } catch (deleteError) {
      console.error(
        "Could not delete pending request:",
        deleteError
      );
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        success: true,
        message: "Payment verified successfully",
        request: finalRequest
      })
    };
  } catch (error) {
    console.error("VERIFY PAYMENT ERROR:", error);

    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({
        success: false,
        message: "Unable to verify payment"
      })
    };
  }
};

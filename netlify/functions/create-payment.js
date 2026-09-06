import { getStore } from "@netlify/blobs";

export default async (req) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return new Response(
      JSON.stringify({
        success: false,
        message: "Method not allowed"
      }),
      {
        status: 405,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }

  try {
    // Check Flutterwave secret key
    const secretKey = process.env.FLW_SECRET_KEY;

    if (!secretKey) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Flutterwave secret key is not configured."
        }),
        {
          status: 500,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Read form data sent from the website
    const body = await req.json();

    const {
      service,
      relationship,
      category,
      celebrantName,
      celebrantPhone,
      senderName,
      whatsappNumber,
      email,
      writeup,
      celebrationDate
    } = body;

    // Prices are controlled by the server
    const servicePrices = {
      "Celebration Announcement Only": 3000,
      "Celebration Phone Call Interview": 7000
    };

    const amount = servicePrices[service];

    // Check service
    if (!amount) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Invalid service selected."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Required fields
    if (!email || !senderName || !celebrantName) {
      return new Response(
        JSON.stringify({
          success: false,
          message: "Please complete the required form fields."
        }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json"
          }
        }
      );
    }

    // Generate unique Flutterwave transaction reference
    const txRef =
      `KULZZY-${Date.now()}-` +
      Math.floor(100000 + Math.random() * 900000);

    /*
     * Save the customer's request temporarily.
     *
     * This information is saved BEFORE payment so that after
     * Flutterwave confirms payment, verify-payment.js can find
     * the exact request connected to this transaction reference.
     */
    const store = getStore("kulzzy-celebration-requests");

    const pendingRequest = {
      requestStatus: "PENDING_PAYMENT",

      txRef: txRef,

      service: service,

      amountRequired: amount,

      currency: "NGN",

      relationship: relationship || "",

      category: category || "",

      celebrantName: celebrantName || "",

      celebrantPhone: celebrantPhone || "",

      senderName: senderName || "",

      whatsappNumber: whatsappNumber || "",

      email: email || "",

      writeup: writeup || "",

      celebrationDate: celebrationDate || "",

      createdAt: new Date().toISOString()
    };

    /*
     * Store the pending request using the transaction reference.
     */
    await store.setJSON(
      `pending/${txRef}`,
      pendingRequest
    );

    /*
     * Return only the information the frontend needs
     * to open Flutterwave Checkout.
     */
    return new Response(
      JSON.stringify({
        success: true,

        publicKey:
          "FLWPUBK-5307a6454182615bb0f9ef448799d87d-X",

        tx_ref: txRef,

        amount: amount,

        currency: "NGN"
      }),
      {
        status: 200,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  } catch (error) {
    console.error("CREATE PAYMENT ERROR:", error);

    return new Response(
      JSON.stringify({
        success: false,
        message: "Unable to create payment."
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json"
        }
      }
    );
  }
};
